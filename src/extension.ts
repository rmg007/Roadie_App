/**
 * @module extension
 * @description VS Code extension entry point. Creates the DI container,
 *   wires real dependencies (ProjectAnalyzer, AgentSpawner, FileGenerator,
 *   RoadieDatabase, LearningDatabase), registers the @roadie Chat Participant,
 *   status bar, configuration reader, and command palette commands.
 *   Routes deactivation through the container's dispose().
 *
 *   SQLite persistence is fully optional — if better-sqlite3 fails to load
 *   (e.g. ABI mismatch), Roadie degrades gracefully to in-memory-only mode
 *   and logs a warning. Everything else continues to work normally.
 *
 * @inputs vscode.ExtensionContext (provided by VS Code at activation time)
 * @outputs Side effects: registered chat participant, status bar, commands,
 *   generated .github/ files, SQLite learning database
 * @depends-on container.ts, shell/*, analyzer/*, model/*, generator/*,
 *   spawner/*, engine/*, learning/learning-database.ts
 * @depended-on-by VS Code (activation/deactivation lifecycle)
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { Container } from './container';
import { registerChatParticipant } from './shell/chat-participant';
import { createStatusBar } from './shell/status-bar';
import { registerCommands, readConfiguration, updateSetting } from './shell/commands';
import { initLogger, getLogger, RoadieLogger } from './shell/logger';
import { getChatLastContext } from './shell/chat-participant';
import { RoadieCodeActionProvider } from './shell/code-action-provider';
import { AgentSpawner } from './spawner/agent-spawner';
import { VSCodeModelProvider } from './shell/vscode-providers';
import { InMemoryProjectModel } from './model/project-model';
import { RoadieDatabase } from './model/database';
import { LearningDatabase } from './learning/learning-database';
import { ProjectAnalyzer } from './analyzer/project-analyzer';
import { FileGenerator } from './generator/file-generator';
import { FileWatcherManager } from './watcher/file-watcher-manager';
import type { StepHandlerFn } from './engine/step-executor';
import type { AgentConfig } from './types';

let container: Container | undefined;

type ChatVariableResolverApi = {
  registerChatVariableResolver: (
    id: string,
    name: string,
    userDescription: string,
    modelDescription: string,
    isSlow: boolean,
    resolver: (
      chatContext: unknown,
      token: vscode.CancellationToken,
    ) => Promise<Array<{ level: vscode.ChatVariableLevel; value: string }>>,
  ) => vscode.Disposable;
};

/**
 * Called by VS Code when the extension is activated.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  container = new Container();

  // Logger must be the first thing initialised — everything else uses it.
  const logger = initLogger();
  container.register(logger);

  const { version } = context.extension.packageJSON as { version: string };
  logger.info(`Roadie v${version} activating…`);

  const config = readConfiguration();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  if (workspaceRoot) {
    logger.info(`Workspace root: ${workspaceRoot}`);
  } else {
    logger.warn('No workspace folder open — file generation and analysis skipped.');
  }

  // ── SQLite persistence (fully fault-tolerant) ────────────────────────────
  // Both RoadieDatabase (project model) and LearningDatabase (workflow history
  // + file snapshots) share the same SQLite file and connection.
  // If better-sqlite3 cannot be loaded (ABI mismatch, missing binary, etc.)
  // we fall back to pure in-memory mode and continue without persistence.
  let roadieDb: RoadieDatabase | null = null;
  let learningDb: LearningDatabase | null = null;

  if (workspaceRoot) {
    try {
      const dbPath = path.join(workspaceRoot, '.github', '.roadie', 'project-model.db');
      roadieDb = new RoadieDatabase(dbPath);

      learningDb = new LearningDatabase();
      learningDb.initialize(roadieDb.getRawDb(), {
        workflowHistory: config.workflowHistory,
      });

      container.register({
        dispose: () => {
          try {
            learningDb?.close();
          } catch {
            // best effort
          }
          try {
            roadieDb?.close();
          } catch {
            // best effort
          }
        },
      });

      const size = learningDb.getDatabaseSize();
      logger.info(
        `SQLite persistence initialised — ${dbPath} ` +
        `(${size} existing records, workflowHistory=${config.workflowHistory})`,
      );
    } catch (err) {
      logger.warn(
        'SQLite unavailable — running without persistence. ' +
        'Workflow history and file snapshots will not be saved.',
        err,
      );
      roadieDb = null;
      learningDb = null;
    }
  }

  // ── Project model ────────────────────────────────────────────────────────
  const projectModel = new InMemoryProjectModel(roadieDb);
  container.register(projectModel);

  // ── File generator ───────────────────────────────────────────────────────
  const fileGenerator = workspaceRoot
    ? new FileGenerator(workspaceRoot, learningDb ?? undefined)
    : null;
  let projectReadyPromise: Promise<void> | null = null;

  async function ensureProjectReady(): Promise<void> {
    if (!workspaceRoot) return;
    if (projectReadyPromise) return projectReadyPromise;

    projectReadyPromise = (async () => {
      const analyzer = new ProjectAnalyzer(projectModel, undefined, learningDb ?? undefined);
      await analyzer.analyze(workspaceRoot);
      logger.info('Project analysis complete');
    })();

    projectReadyPromise.catch(() => {
      // preserve the original rejection for concurrent callers, but allow
      // subsequent calls to retry only after the promise settles.
      projectReadyPromise = null;
    });

    return projectReadyPromise;
  }
  // ── File watcher → generator wiring ─────────────────────────────────────
  if (workspaceRoot && fileGenerator) {
    const watcher = new FileWatcherManager();
    watcher.start();
    container.register(
      watcher.onBatch((events) => {
        // FullRescanEvent sentinel: events is [{ type: 'FULL_RESCAN' }]
        if (!Array.isArray(events) || events.length === 0) return;
        const first = events[0] as { type?: string; priority?: string; classifiedAs?: string };
        if (first.type === 'FULL_RESCAN') {
          fileGenerator.generateAll(projectModel).catch((err: unknown) => {
            logger.warn('FileGenerator: regeneration after full-rescan failed', err);
          });
          return;
        }

        const fileEvents = events as Array<{ priority: string; classifiedAs: string }>;
        const needsFullRegen = fileEvents.some(
          (e) => e.priority === 'HIGH' || e.classifiedAs === 'DEPENDENCY_CHANGE',
        );
        const needsConfigRegen = !needsFullRegen && fileEvents.some(
          (e) => e.classifiedAs === 'CONFIG_CHANGE',
        );

        if (needsFullRegen) {
          logger.debug('FileGenerator: HIGH/DEPENDENCY_CHANGE event — regenerating all files');
          fileGenerator.generateAll(projectModel).catch((err: unknown) => {
            logger.warn('FileGenerator: regeneration failed', err);
          });
        } else if (needsConfigRegen) {
          logger.debug('FileGenerator: CONFIG_CHANGE event — regenerating config-sensitive files');
          void Promise.allSettled([
            fileGenerator.generate('copilot_instructions', projectModel),
            fileGenerator.generate('claude_md', projectModel),
          ]).then((results) => {
            for (const result of results) {
              if (result.status === 'rejected') {
                logger.warn('FileGenerator: config regeneration failed', result.reason);
              }
            }
          });
        }
      }),
    );

    // Register VS Code file system watchers for relevant source/config files only
    const vsWatchers = [
      vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx,json,md,yml,yaml,lock,toml}'),
      vscode.workspace.createFileSystemWatcher('**/{go.mod,go.sum,Pipfile,Pipfile.lock,Gemfile}'),
    ];

    for (const vsWatcher of vsWatchers) {
      container.register(vsWatcher);
      container.register(
        vsWatcher.onDidChange((uri) => watcher.handleFileEvent(uri.fsPath, 'change')),
      );
      container.register(
        vsWatcher.onDidCreate((uri) => watcher.handleFileEvent(uri.fsPath, 'create')),
      );
      container.register(
        vsWatcher.onDidDelete((uri) => watcher.handleFileEvent(uri.fsPath, 'delete')),
      );
    }
    container.register({ dispose: () => watcher.dispose() });
  }

  // ── AgentSpawner (real step handler) ────────────────────────────────────
  const agentSpawner  = new AgentSpawner(new VSCodeModelProvider());

  const stepHandler: StepHandlerFn = async (step, workflowContext, attemptInfo) => {
    const previousOutput =
      workflowContext.previousStepResults?.map((r) => r.output).join('\n') ?? '';

    // Per-step context scoping — inject only the slice each step needs
    const STEP_SCOPE_MAP: Record<string, 'full' | 'stack' | 'structure' | 'commands' | 'patterns'> = {
      'locate-error':        'structure',
      'diagnose-root-cause': 'full',
      'generate-fix':        'patterns',
      'verify-tests':        'commands',
      'scan-siblings':       'structure',
      'analyze-requirements':'stack',
      'present-plan':        'full',
      'quality-review':      'patterns',
      'run-tests':           'commands',
    };
    const contextScope = step.contextScope ?? STEP_SCOPE_MAP[step.id] ?? 'full';

    if (workspaceRoot) {
      try {
        await ensureProjectReady();
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        getLogger().error(`[${step.id}] Project analysis failed: ${error}`);
        return {
          stepId:     step.id,
          status:     'failed',
          output:     '',
          tokenUsage: { input: 0, output: 0 },
          attempts:   1,
          modelUsed:  '',
          error,
        };
      }
    }

    const agentConfig: AgentConfig = {
      role:           step.agentRole,
      modelTier:      attemptInfo.tier,
      tools:          step.toolScope,
      promptTemplate: step.promptTemplate,
      context: {
        prompt:          workflowContext.prompt,
        project_context: workflowContext.projectModel
                           .toContext({ maxTokens: 2_000, scope: contextScope })
                           .serialized,
        previous_output: previousOutput,
        ...(attemptInfo.previousError
          ? { previous_error: attemptInfo.previousError }
          : {}),
      },
      cancellation: workflowContext.cancellation.signal,
      timeoutMs: step.timeoutMs,
    };

    const agentResult = await agentSpawner.spawn(agentConfig);

    return {
      stepId:      step.id,
      status:      agentResult.status === 'success' ? 'success' : 'failed',
      output:      agentResult.output,
      toolResults: agentResult.toolResults,
      tokenUsage:  agentResult.tokenUsage,
      attempts:    1,
      modelUsed:   agentResult.model,
      error:       agentResult.error,
    };
  };

  // ── Chat Participant ─────────────────────────────────────────────────────
  container.register(
    registerChatParticipant({
      stepHandler,
      projectModel,
      learningDb: learningDb ?? undefined,
      contextLensLevel: config.contextLensLevel,
    }),
  );

  // ── Code Action Provider ─────────────────────────────────────────────────
  // Internal bridge command: opens Copilot Chat with a prefilled @roadie query
  const openChatCmd = vscode.commands.registerCommand('roadie._openChat', (query: string) => {
    void vscode.commands.executeCommand(
      'workbench.action.chat.open',
      { query },
    );
  });
  container.register(openChatCmd);

  const codeActionProvider = new RoadieCodeActionProvider();
  container.register(
    vscode.languages.registerCodeActionsProvider(
      ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].map((language) => ({ language })),
      codeActionProvider,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite] },
    ),
  );

  // #roadie chat variable — exposes ProjectModel.toContext() to any participant
  const chatApi = vscode.chat as unknown as ChatVariableResolverApi;
  const chatVariableDisposable = chatApi.registerChatVariableResolver(
    'roadie',
    'roadie',
    'Inject Roadie project context (tech stack, patterns, commands) into any chat.',
    'Roadie project context: tech stack, directory structure, patterns, and detected commands.',
    false,
    async (_chatContext: unknown, _token: vscode.CancellationToken) => {
      await ensureProjectReady().catch(() => undefined);
      const ctx = projectModel.toContext({ maxTokens: 2_000, scope: 'full' });
      return [
        {
          level: vscode.ChatVariableLevel.Full,
          value: ctx.serialized,
        },
      ];
    },
  );
  container.register(chatVariableDisposable);

  // ── Status bar ───────────────────────────────────────────────────────────
  container.register(createStatusBar());

  // ── Commands ─────────────────────────────────────────────────────────────
  const commands = registerCommands({
    onInit: async () => {
      if (!workspaceRoot) {
        getLogger().warn('roadie.init: no workspace folder — skipping');
        return;
      }
      getLogger().info('roadie.init: starting analysis…');
      const analyzer = new ProjectAnalyzer(projectModel, undefined, learningDb ?? undefined);
      await analyzer.analyze(workspaceRoot);

      if (fileGenerator) {
        const files   = await fileGenerator.generateAll(projectModel);
        const written = files.filter((f) => f.written).map((f) => f.path);
        getLogger().info(
          written.length
            ? `roadie.init: generated ${written.join(', ')}`
            : 'roadie.init: all files up-to-date',
        );
        if (written.length) {
          void vscode.window.showInformationMessage(
            `Roadie: Generated ${written.join(', ')}`,
          );
        }
      }
    },

    onRescan: async () => {
      if (!workspaceRoot) {
        getLogger().warn('roadie.rescan: no workspace folder — skipping');
        return;
      }
      getLogger().info('roadie.rescan: starting analysis…');
      const analyzer = new ProjectAnalyzer(projectModel, undefined, learningDb ?? undefined);
      await analyzer.analyze(workspaceRoot);
      getLogger().info('roadie.rescan: complete');
    },

    onReset: () => {
      getLogger().info('roadie.reset: clearing project model');
      projectModel.update({
        techStack:   [],
        directories: [],
        patterns:    [],
        commands:    [],
      });
    },

    onEnableWorkflowHistory: async () => {
      // 1. Persist to VS Code settings (survives restarts)
      await updateSetting('workflowHistory', true);
      // 2. Hot-update the live LearningDatabase instance (takes effect immediately)
      if (learningDb) {
        learningDb.setWorkflowHistory(true);
        getLogger().info('Workflow history enabled — every @roadie run will now be recorded');
        void vscode.window.showInformationMessage(
          'Roadie: Workflow history enabled. Every @roadie run will be logged to ' +
          '.github/.roadie/project-model.db',
        );
      } else {
        getLogger().warn(
          'Workflow history setting saved, but SQLite is unavailable — ' +
          'history will start recording after the database initialises on next reload.',
        );
        void vscode.window.showWarningMessage(
          'Roadie: Setting saved, but SQLite is unavailable in this session. ' +
          'Reload the window to activate history recording.',
        );
      }
    },

    onDisableWorkflowHistory: async () => {
      await updateSetting('workflowHistory', false);
      if (learningDb) {
        learningDb.setWorkflowHistory(false);
      }
      getLogger().info('Workflow history disabled');
      void vscode.window.showInformationMessage(
        'Roadie: Workflow history disabled. Existing records are kept in the database.',
      );
    },

    onStats: () => {
      if (!learningDb) {
        void vscode.window.showInformationMessage(
          'Roadie Stats: SQLite unavailable — no persistent data recorded yet.',
        );
        return;
      }
      const stats = learningDb.getWorkflowStats();
      const dbSize = learningDb.getDatabaseSize();
      const log = getLogger();

      if (stats.totalWorkflows === 0) {
        log.info('roadie.stats: no workflows recorded yet');
        void vscode.window.showInformationMessage(
          'Roadie Stats: No workflows recorded yet. ' +
          'Use @roadie in chat to start tracking.',
        );
        return;
      }

      const rate = (stats.successRate * 100).toFixed(1);
      const avgMs = stats.averageDurationMs.toLocaleString();

      // Log full breakdown to Output channel
      log.info('─── Roadie Workflow Stats ───');
      log.info(`Total runs:       ${stats.totalWorkflows}`);
      log.info(`Success rate:     ${rate}%  (${stats.successCount} ok / ${stats.failureCount} failed)`);
      log.info(`Avg duration:     ${avgMs}ms`);
      log.info(`DB records:       ${dbSize}`);
      log.info('By workflow type:');
      for (const [type, data] of Object.entries(stats.byType)) {
        const typeRate = data.count > 0
          ? ((data.successCount / data.count) * 100).toFixed(0)
          : '0';
        log.info(`  ${type.padEnd(16)} ${data.count} runs, ${typeRate}% success`);
      }
      log.info('────────────────────────────');

      // Show summary in notification
      void vscode.window.showInformationMessage(
        `Roadie: ${stats.totalWorkflows} workflows — ${rate}% success — avg ${avgMs}ms. ` +
        'See Output > Roadie for full breakdown.',
      );
    },

    onGetScanSummary: () => {
      const stack = projectModel.getTechStack().length;
      const cmds  = projectModel.getCommands().length;
      const dirs  = projectModel.getDirectories().length;
      getLogger().info(`roadie.getScanSummary: ${stack} tech entries, ${cmds} commands, ${dirs} directories`);
      void vscode.window.showInformationMessage(
        `Roadie Scan Summary: ${stack} tech entries, ${cmds} commands, ${dirs} directories. ` +
        'See Output > Roadie for details.',
      );
    },

    onRunWorkflow: async () => {
      const choice = await vscode.window.showQuickPick(
        ['bug_fix', 'feature', 'refactor', 'review', 'document', 'dependency', 'onboard'],
        { placeHolder: 'Select a workflow to run via @roadie in chat' },
      );
      if (choice) {
        void vscode.window.showInformationMessage(
          `Roadie: Use "@roadie ${choice}" in the chat panel to run this workflow.`,
        );
      }
    },

    onDoctor: async () => {
      getLogger().info('roadie.doctor: running diagnostics…');
      const checks: Array<{ label: string; ok: boolean }> = [
        { label: 'Workspace open',            ok: !!workspaceRoot },
        { label: 'Project model populated',   ok: projectModel.getTechStack().length > 0 },
        { label: 'SQLite available',          ok: !!learningDb },
        { label: 'File generator available',  ok: !!fileGenerator },
      ];
      const log = getLogger();
      log.info('─── Roadie Doctor ───');
      for (const c of checks) {
        log.info(`${c.ok ? '✓' : '✗'} ${c.label}`);
      }
      log.info('─────────────────────');
      const allOk = checks.every((c) => c.ok);
      void vscode.window.showInformationMessage(
        allOk
          ? 'Roadie Doctor: all checks passed. See Output > Roadie for details.'
          : 'Roadie Doctor: some checks failed. See Output > Roadie for details.',
      );
    },

    onShowLastContext: async () => {
      (getLogger() as RoadieLogger).show();
      const snap = getChatLastContext();
      if (snap) {
        const choice = await vscode.window.showInformationMessage(
          'Roadie: Last context shown in Output. Copy to clipboard?',
          'Copy',
          'Dismiss',
        );
        if (choice === 'Copy') await vscode.env.clipboard.writeText(snap);
      }
    },

    onShowMyStats: async () => {
      if (!learningDb) {
        void vscode.window.showInformationMessage(
          'Roadie: SQLite unavailable — no stats recorded yet.',
        );
        return;
      }

      const stats = learningDb.getWorkflowStats();
      const cancelStats = learningDb.getWorkflowCancellationStats();
      const hotFiles = learningDb.getMostEditedFiles(10);
      const patterns = projectModel.getPatterns()
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10);

      const lines: string[] = [
        '# Roadie Stats',
        '',
        `*Generated: ${new Date().toLocaleString()}*`,
        '',
      ];

      if (Object.keys(stats.byType).length === 0) {
        lines.push('*No workflow data recorded yet. Enable Roadie workflow history to collect stats.*', '');
      } else {
        lines.push('## Per-Intent Accuracy', '', '| Intent | Runs | Success | Success% | Cancel% |', '|--------|------|---------|----------|---------|');
        for (const [type, data] of Object.entries(stats.byType)) {
          const successPct = data.count > 0
            ? ((data.successCount / data.count) * 100).toFixed(0)
            : '0';
          const cancelRow = cancelStats.find((r) => r.workflowType === type);
          const cancelPct = cancelRow && cancelRow.totalRuns > 0
            ? ((cancelRow.cancelledRuns / cancelRow.totalRuns) * 100).toFixed(0)
            : '0';
          lines.push(`| ${type} | ${data.count} | ${data.successCount} | ${successPct}% | ${cancelPct}% |`);
        }
      }

      lines.push('', '## Most-Edited Files', '');
      if (hotFiles.length === 0) {
        lines.push('*No edit data recorded yet.*');
      } else {
        for (const f of hotFiles) {
          const safeFilePath = `\`${f.filePath.replace(/`/g, '\u200b`')}\``;
          lines.push(`- ${safeFilePath} — ${f.editCount} edits`);
        }
      }

      lines.push('', '## Top Patterns (by confidence)', '');
      if (patterns.length === 0) {
        lines.push('*No patterns detected yet.*');
      } else {
        for (const p of patterns) {
          lines.push(`- **${(p.confidence * 100).toFixed(0)}%** ${p.description}`);
        }
      }

      const content = lines.join('\n');
      const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
      await vscode.window.showTextDocument(doc);
    },
  });

  for (const cmd of commands) {
    container.register(cmd);
  }

  context.subscriptions.push(container);
  logger.info('Roadie activated ✓');
}

/**
 * Called by VS Code when the extension is deactivated.
 */
export function deactivate(): void {
  getLogger().info('Roadie deactivating…');
  container?.dispose();
  container = undefined;
}

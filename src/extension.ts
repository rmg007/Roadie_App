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
import { initLogger, getLogger } from './shell/logger';
import { VSCodeModelProvider, VSCodeFileSystemProvider } from './shell/vscode-providers';
import { AgentSpawner } from './spawner/agent-spawner';
import { InMemoryProjectModel } from './model/project-model';
import { RoadieDatabase } from './model/database';
import { LearningDatabase } from './learning/learning-database';
import { ProjectAnalyzer } from './analyzer/project-analyzer';
import { FileGenerator } from './generator/file-generator';
import { FileWatcherManager } from './watcher/file-watcher-manager';
import type { FileChangeEvent } from './watcher/file-watcher-manager';
import type { StepHandlerFn } from './engine/step-executor';
import type { AgentConfig } from './types';

let container: Container | undefined;

/**
 * Called by VS Code when the extension is activated.
 */
export function activate(context: vscode.ExtensionContext): void {
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

  // ── File system provider ─────────────────────────────────────────────────
  const fileSystemProvider = new VSCodeFileSystemProvider(vscode.workspace.textDocuments);

  // ── File generator ───────────────────────────────────────────────────────
  const fileGenerator = workspaceRoot
    ? new FileGenerator(workspaceRoot, learningDb ?? undefined, fileSystemProvider)
    : null;

  // ── Startup analysis + file generation ──────────────────────────────────
  if (workspaceRoot) {
    logger.info('Starting startup project analysis…');
    const analyzer = new ProjectAnalyzer(projectModel);
    analyzer
      .analyze(workspaceRoot)
      .then(async () => {
        const stack = projectModel.getTechStack().length;
        const cmds  = projectModel.getCommands().length;
        logger.info(`Startup analysis complete — ${stack} tech entries, ${cmds} commands`);

        if (fileGenerator) {
          logger.info('Generating .github/ files…');
          const files   = await fileGenerator.generateAll(projectModel);
          const written = files.filter((f) => f.written).map((f) => f.path);
          const skipped = files.filter((f) => !f.written).map((f) => f.path);
          if (written.length) logger.info(`Files written:  ${written.join(', ')}`);
          if (skipped.length) logger.debug(`Files skipped (unchanged): ${skipped.join(', ')}`);
        }
      })
      .catch((err: unknown) => {
        logger.error('Startup analysis failed', err);
      });
  }

  // ── File watcher: auto-rescan on dependency / config changes ────────────
  // Watches package.json, lock files, tsconfig, jest/vite/webpack configs, etc.
  // On any HIGH-priority (DEPENDENCY_CHANGE) or MEDIUM-priority (CONFIG_CHANGE)
  // event, re-runs the full project analysis and regenerates .github/ files.
  // The FileWatcherManager handles debouncing (500 ms), deduplication, and
  // add+delete cancellation before dispatching the classified batch.
  if (workspaceRoot) {
    const fileWatcher = new FileWatcherManager();
    container.register(fileWatcher);

    const fsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        workspaceRoot,
        '**/{package.json,package-lock.json,pnpm-lock.yaml,yarn.lock,bun.lockb,' +
        'tsconfig.json,tsconfig.*.json,jest.config.*,vitest.config.*,' +
        'vite.config.*,webpack.config.*,rollup.config.*,.babelrc,.eslintrc*,.prettierrc*}',
      ),
    );
    container.register(fsWatcher);

    const forwardEvent = (type: 'create' | 'change' | 'delete') =>
      (uri: vscode.Uri) => fileWatcher.handleFileEvent(uri.fsPath, type);

    fsWatcher.onDidCreate(forwardEvent('create'));
    fsWatcher.onDidChange(forwardEvent('change'));
    fsWatcher.onDidDelete(forwardEvent('delete'));

    // Shared re-analysis logic invoked by the batch handler below.
    const runRescan = async (): Promise<void> => {
      try {
        const analyzer = new ProjectAnalyzer(projectModel);
        await analyzer.analyze(workspaceRoot);
        const cmds = projectModel.getCommands().length;
        getLogger().info(`File watcher: re-analysis complete — ${cmds} commands`);

        if (fileGenerator) {
          const files   = await fileGenerator.generateAll(projectModel);
          const written = files.filter((f) => f.written).map((f) => f.path);
          if (written.length) {
            getLogger().info(`File watcher: .github/ updated — ${written.join(', ')}`);
          } else {
            getLogger().debug('File watcher: .github/ files unchanged');
          }
        }
      } catch (err) {
        getLogger().error('File watcher: re-analysis failed', err);
      }
    };

    const batchSub = fileWatcher.onBatch(async (events) => {
      // Detect the full-rescan sentinel (batch overflow > maxBatchSize).
      if (events.length === 1 && 'type' in events[0]) {
        getLogger().info('File watcher: batch overflow — running full rescan…');
        await runRescan();
        return;
      }

      // Normal batch: only re-analyse for HIGH (dependency) or MEDIUM (config) changes.
      const fileEvents = events as FileChangeEvent[];
      const relevant   = fileEvents.filter(
        (e) => e.priority === 'HIGH' || e.priority === 'MEDIUM',
      );
      if (relevant.length === 0) return;

      const names = relevant.map((e) => path.basename(e.filePath)).join(', ');
      getLogger().info(`File watcher: ${names} changed — re-analysing…`);
      await runRescan();
    });
    container.register(batchSub);

    fileWatcher.start();
    logger.debug('File watcher active — watching dependency and config files');
  }

  // ── AgentSpawner (real step handler) ────────────────────────────────────
  const modelProvider = new VSCodeModelProvider();
  const agentSpawner  = new AgentSpawner(modelProvider);

  const stepHandler: StepHandlerFn = async (step, workflowContext, attemptInfo) => {
    const previousOutput =
      workflowContext.previousStepResults?.map((r) => r.output).join('\n') ?? '';

    const agentConfig: AgentConfig = {
      role:           step.agentRole,
      modelTier:      attemptInfo.tier,
      tools:          step.toolScope,
      promptTemplate: step.promptTemplate,
      context: {
        prompt:          workflowContext.prompt,
        project_context: workflowContext.projectModel
                           .toContext({ maxTokens: 2_000 })
                           .serialized,
        previous_output: previousOutput,
        ...(attemptInfo.previousError
          ? { previous_error: attemptInfo.previousError }
          : {}),
      },
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
    }),
  );

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
      const analyzer = new ProjectAnalyzer(projectModel);
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
      const analyzer = new ProjectAnalyzer(projectModel);
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

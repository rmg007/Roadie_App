/**
 * @module chat-participant
 * @description Registers the @roadie Chat Participant with VS Code.
 *   Routes developer messages through intent classification, then
 *   dispatches to the appropriate workflow via WorkflowEngine.
 *   Records every workflow outcome to LearningDatabase when available.
 * @inputs Developer chat messages via VS Code Chat Participant API
 * @outputs Streamed markdown responses to the chat UI
 * @depends-on vscode, intent-classifier, workflow-engine, project-model,
 *   learning-database, logger
 * @depended-on-by extension.ts (registration at activation)
 */

import * as vscode from 'vscode';
import type { WorkflowDefinition, WorkflowContext, ProjectModel, ClassificationResult } from '../types';
import { VSCodeProgressReporter, VSCodeCancellationHandle } from './vscode-providers';
import { IntentClassifier } from '../classifier/intent-classifier';
import { WorkflowEngine } from '../engine/workflow-engine';
import { StepExecutor, type StepHandlerFn } from '../engine/step-executor';
import { BUG_FIX_WORKFLOW } from '../engine/definitions/bug-fix';
import { FEATURE_WORKFLOW } from '../engine/definitions/feature';
import { REFACTOR_WORKFLOW } from '../engine/definitions/refactor';
import { REVIEW_WORKFLOW } from '../engine/definitions/review';
import { DOCUMENT_WORKFLOW } from '../engine/definitions/document';
import { DEPENDENCY_WORKFLOW } from '../engine/definitions/dependency';
import { ONBOARD_WORKFLOW } from '../engine/definitions/onboard';
import type { LearningDatabase } from '../learning/learning-database';
import { getLogger } from './logger';
import { SessionManager } from './session-manager';
import { ClaudeMdParser } from '../analyzer/claude-md-parser';

const PARTICIPANT_ID = 'roadie';

/** Stores the most recent serialized context snapshot for `Roadie: Show Last Context`. */
let _lastContextSnapshot = '';

/** Global SessionManager instance — tracks conversation state across chat turns. */
const _sessionManager = new SessionManager();

/** Cache for extractThreadId — maps FNV-1a hashes to stable thread IDs. */
const _threadIdCache = { byFirstPromptHash: new Map<number, string>() };

/** Active engines keyed by threadId — keeps instances alive across turns. */
const _activeEngines = new Map<string, WorkflowEngine>();

// H8: Set learning database on session manager when available
let _sessionManagerInitialized = false;

/** Returns the last context snapshot written before an LLM call. */
export function getChatLastContext(): string {
  return _lastContextSnapshot;
}

/**
 * Map intent types to workflow definitions.
 * Special intents ('resume', 'clarify', 'general_chat') are NOT in this map
 * and must be handled by dedicated branches before the lookup.
 */
const WORKFLOW_MAP: Record<string, WorkflowDefinition> = {
  bug_fix:    BUG_FIX_WORKFLOW,
  feature:    FEATURE_WORKFLOW,
  refactor:   REFACTOR_WORKFLOW,
  review:     REVIEW_WORKFLOW,
  document:   DOCUMENT_WORKFLOW,
  dependency: DEPENDENCY_WORKFLOW,
  onboard:    ONBOARD_WORKFLOW,
};

/**
 * Create and register the @roadie Chat Participant.
 * Returns a disposable for cleanup.
 *
 * @param deps Optional dependencies for testability. In production, uses real
 *   implementations. In tests, inject mocks.
 */
export function registerChatParticipant(deps?: {
  classifier?: IntentClassifier;
  stepHandler?: StepHandlerFn;
  projectModel?: ProjectModel;
  modelProvider?: any; // ModelProvider from vscode-providers
  learningDb?: LearningDatabase;
  contextLensLevel?: 'off' | 'summary' | 'full';
}): vscode.Disposable {
  const classifier = deps?.classifier ?? new IntentClassifier();

  // Default step handler — placeholder until AgentSpawner is wired (Step 7+)
  const stepHandler: StepHandlerFn = deps?.stepHandler ?? (async (step) => ({
    stepId:     step.id,
    status:     'success' as const,
    output:     `[Placeholder] Step "${step.name}" would execute here with AgentSpawner.`,
    tokenUsage: { input: 0, output: 0 },
    attempts:   1,
    modelUsed:  'placeholder',
  }));

  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult> => {
    const log = getLogger();
    const startMs = Date.now();

    // H8: Initialize session manager with learning database on first call
    if (!_sessionManagerInitialized && deps?.learningDb) {
      _sessionManager.setLearningDatabase(deps.learningDb);
      _sessionManagerInitialized = true;
    }

    // Extract threadId from chat context history using FNV-1a hash of first prompt
    const threadId = extractThreadId(context as any, _threadIdCache);

    const session = _sessionManager.getSession(threadId);

    // Truncate the prompt for log readability (max 80 chars)
    const preview = request.prompt.length > 80
      ? `${request.prompt.slice(0, 80)}…`
      : request.prompt;
    log.info(`@roadie received: "${preview}" (threadId: ${threadId})`);

    // Check if this thread has a paused workflow awaiting resumption
    if (session.paused && session.pausedSessionId) {
      log.info(
        `Thread ${threadId} has paused workflow (sessionId: ${session.pausedSessionId}). ` +
        `Routing to resumption instead of classification.`,
      );

      // Parse user approval (B9 — stricter acceptance: accept y, yes, ok, confirm, etc.)
      const ack = /^(y|yes|ok(ay)?|confirm|continue|proceed|go|sure)[!.\s]*$/i;
      const nack = /^(n|no|cancel|abort|stop|nope)[!.\s]*$/i;
      const trimmed = request.prompt.trim();
      const approval: 'approve' | 'reject' | 'unclear' =
        ack.test(trimmed) ? 'approve' : nack.test(trimmed) ? 'reject' : 'unclear';

      if (approval === 'unclear') {
        response.markdown(
          `I didn't catch that — reply \`yes\` to continue or \`no\` to abort.`,
        );
        return {};
      }

      const userApproval = approval === 'approve';

      response.markdown(
        `**Resuming paused workflow** (${session.workflowId || 'unknown'}) ` +
        `with approval: ${userApproval ? '✓ Continue' : '✗ Abort'}\n\n`,
      );

      const storedEngine = _activeEngines.get(threadId);
      if (storedEngine && session.pausedSessionId) {
        // Rebind stale turn handles with proper VS Code adapters (P0-γ)
        storedEngine.rebindTurnHandles(session.pausedSessionId, {
          cancellation: new VSCodeCancellationHandle(token),
          progress: new VSCodeProgressReporter(response),
        });

        let resumeResult;
        try {
          resumeResult = await storedEngine.resume(session.pausedSessionId, userApproval);
        } catch (e) {
          if (String(e).includes('Session not found') && deps?.learningDb) {
            resumeResult = await storedEngine.resumeFromSnapshot(
              session.pausedSessionId,
              new VSCodeProgressReporter(response),
              deps?.projectModel,
            );
          } else {
            throw e;
          }
        }

        _sessionManager.resumeFromPaused(threadId);
        if (
          resumeResult.state === 'COMPLETED' ||
          resumeResult.state === 'CANCELLED' ||
          resumeResult.state === 'FAILED'
        ) {
          _activeEngines.delete(threadId);
        } else if (resumeResult.pausedSessionId) {
          _sessionManager.markPaused(threadId, resumeResult.pausedSessionId);
        }

        response.markdown(`\n---\n\n${resumeResult.summary}\n\n`);
        response.markdown(
          `*Completed in ${resumeResult.duration}ms — ${resumeResult.stepResults.length} steps executed.*`,
        );
        return {};
      }

      // No stored engine — fall back, clear paused state
      _sessionManager.resumeFromPaused(threadId);
      response.markdown(
        `*No active engine for this workflow. Please start a new task.*`,
      );
      return {};
    }

    // Slash subcommand: skip classification, route directly to workflow
    const COMMAND_WORKFLOW_MAP: Record<string, string> = {
      fix:        'bug_fix',
      document:   'document',
      review:     'review',
      refactor:   'refactor',
      onboard:    'onboard',
      dependency: 'dependency',
    };

    let classification: ClassificationResult;
    // Normalize command by removing 'workflow:' prefix if present (VS Code passes declared name)
    const normalizedCmd = (request.command ?? '').replace(/^workflow:/, '');
    if (normalizedCmd && COMMAND_WORKFLOW_MAP[normalizedCmd]) {
      const intentKey = COMMAND_WORKFLOW_MAP[normalizedCmd];
      log.info(`Slash command /${request.command} → intent: ${intentKey} (no classification)`);
      // Build a synthetic classification result so the rest of the handler is unchanged
      classification = {
        intent:     intentKey,
        confidence: 1.0,
        signals:    [`slash:/${request.command}`],
        requiresLLM: false,
      };
      // Fall through to step 3 (workflow context build) using this classification
      // Implementation: extract steps 3–6 into a shared helper or duplicate minimally
    } else {
      // 1. Classify intent
      classification = classifier.classify(request.prompt);

      // Apply learning-based confidence adjustment (if DB available and has enough data)
      if (deps?.learningDb) {
        try {
          const stats = deps.learningDb.getWorkflowStats();
          const cancelStats = deps.learningDb.getWorkflowCancellationStats();
          classification = classifier.adjustWithLearning(classification, stats, cancelStats);
        } catch {
          // Non-fatal — continue with unadjusted confidence
        }
      }
    }

    log.info(
      `Intent: ${classification.intent} ` +
      `(confidence: ${classification.confidence.toFixed(2)}, ` +
      `signals: [${classification.signals.join(', ')}])`,
    );

    // 2. Handle 'resume' intent — list or auto-resume incomplete workflows
    if (classification.intent === 'resume') {
      log.info(`Detected 'resume' intent (signals: ${classification.signals.join(', ')})`);
      const workflows = _sessionManager.listIncompleteWorkflows(threadId);

      if (workflows.length === 0) {
        log.info(`No incomplete workflows to resume.`);
        response.markdown(`**No incomplete workflows found.** Start a new task or ask for help!`);
        return {};
      }

      if (workflows.length === 1) {
        // Auto-resume single workflow
        const workflow = workflows[0];
        log.info(`Auto-resuming single workflow: ${workflow.workflowId} (${workflow.progress})`);
        response.markdown(
          `**Resuming workflow:** ${workflow.workflowId}\n\n` +
          `*Progress: ${workflow.progress}*\n\n`,
        );
        const storedEngine = _activeEngines.get(threadId);
        if (storedEngine && session.pausedSessionId) {
          storedEngine.rebindTurnHandles(session.pausedSessionId, {
            cancellation: new VSCodeCancellationHandle(token),
            progress: new VSCodeProgressReporter(response),
          });
          const resumeResult = await storedEngine.resume(session.pausedSessionId, true);
          _sessionManager.resumeFromPaused(threadId);
          response.markdown(`\n${resumeResult.summary}\n`);
        } else {
          response.markdown(`*No active engine for this workflow. Please start a new task.*`);
        }
        return {};
      }

      // Multiple workflows — ask user to pick
      const list = workflows.map((w) => `- **${w.workflowId}** (${w.progress})`).join('\n');
      log.info(`Found ${workflows.length} incomplete workflows; listing for user selection.`);
      response.markdown(
        `**Found ${workflows.length} incomplete workflows:**\n\n${list}\n\n` +
        `Which would you like to resume? (e.g., "resume task-xyz")`,
      );
      return {};
    }

    // 3. Handle 'clarify' intent — user is correcting/refining previous intent (Bug 5)
    if (classification.intent === 'clarify') {
      log.info(`Detected 'clarify' intent (signals: ${classification.signals.join(', ')})`);

      // If a paused workflow exists, route to resumption
      if (session.paused && session.pausedSessionId) {
        log.info(
          `'clarify' intent with paused workflow (${session.pausedSessionId}). ` +
          `Resuming previous task.`,
        );
        response.markdown(
          `**I see you're refining your previous request.** ` +
          `Let me update the workflow and resume...\n\n`,
        );
        const storedEngine = _activeEngines.get(threadId);
        if (storedEngine) {
          storedEngine.rebindTurnHandles(session.pausedSessionId, {
            cancellation: new VSCodeCancellationHandle(token),
            progress: new VSCodeProgressReporter(response),
          });
          const resumeResult = await storedEngine.resume(session.pausedSessionId, true);
          _sessionManager.resumeFromPaused(threadId);
          response.markdown(`\n${resumeResult.summary}\n`);
        } else {
          response.markdown(
            `*Clarification noted but no active engine found. Please start a new task.*`,
          );
        }
        return {};
      } else if (
        session.workflowId &&
        isLikelyWorkflowContinuationPrompt(request.prompt) &&
        WORKFLOW_MAP[session.workflowId]
      ) {
        // No paused workflow — check if this looks like a workflow continuation (Bug 5 hardening)
        log.info(
          `'clarify' intent with prior workflow ${session.workflowId} + short prompt → carry-over`,
        );
        classification = {
          intent: session.workflowId,
          confidence: 0.75,
          signals: [...classification.signals, 'clarify:carry-over'],
          requiresLLM: false,
        };
        // Fall through to workflow dispatch
      } else {
        // No paused workflow, no continuation prompt, or workflow unknown — ask for clarification
        log.info(
          `'clarify' intent detected but no paused workflow or continuation prompt. ` +
          `Asking for clarification.`,
        );
        response.markdown(
          `**I'm not sure what you mean.** Are you:\n\n` +
          `1. Refining the previous task or request?\n` +
          `2. Starting something completely new?\n\n` +
          `Please clarify so I can help you better.`,
        );
        return {};
      }
    }

    // 4. Check if we have a workflow for this intent
    let workflow = WORKFLOW_MAP[classification.intent];

    // Carry-over: if no workflow matched but a prior workflow exists and
    // the prompt looks like a continuation, re-use the prior intent
    if (
      !workflow &&
      session.workflowId &&
      WORKFLOW_MAP[session.workflowId] &&
      isLikelyWorkflowContinuationPrompt(request.prompt)
    ) {
      log.info(
        `No workflow for '${classification.intent}' but prior workflow '${session.workflowId}' ` +
        `exists and prompt looks like continuation → carry-over`,
      );
      classification = {
        intent: session.workflowId,
        confidence: 0.75,
        signals: [...classification.signals, 'carry-over:prior-workflow'],
        requiresLLM: false,
      };
      workflow = WORKFLOW_MAP[classification.intent];
    }

    if (!workflow) {
      // No workflow — enriched passthrough (general_chat or unimplemented intent)
      if (classification.requiresLLM && request.model?.sendRequest) {
        log.warn(
          `Intent unclear (confidence: ${classification.confidence.toFixed(2)}) — ` +
          'treating as general_chat, delegating to LLM',
        );
        response.markdown(
          `**Roadie v0.10.2**\n\n*Intent unclear (confidence: ${classification.confidence.toFixed(2)}). Asking the LLM...*\n\n`,
        );

        try {
          const messages = [
            vscode.LanguageModelChatMessage.User(request.prompt)
          ];
          log.info(`[general_chat] Requesting LLM fallback for prompt: "${request.prompt.slice(0, 50)}..."`);
          
          if (!request.model) {
            log.error('[general_chat] request.model is missing');
            response.markdown("Roadie encountered an internal error: `request.model` is missing. This usually means the chat participant is being called in an unsupported context.");
            return { metadata: { command: 'general_chat', error: 'missing_model' } };
          }

          const result = await request.model.sendRequest(messages, {}, token);
          log.info(`[general_chat] LLM request initiated with model: ${request.model.name ?? 'unknown'}`);
          
          let chunkCount = 0;
          for await (const chunk of result.text) {
            response.markdown(chunk);
            chunkCount++;
          }
          log.info(`[general_chat] LLM response complete (${chunkCount} chunks streamed)`);
          return { metadata: { command: 'general_chat' } };
        } catch (err) {
          log.error('LLM request failed', err);
          response.markdown(
            "Roadie couldn't reach the model to handle this chat. " +
              "This can happen if you're offline or your model quota is exceeded. " +
              `Error: ${err instanceof Error ? err.message : String(err)}`,
          );
          return { metadata: { command: 'general_chat', error: 'llm_failed' } };
        }
      } else if (classification.intent === 'command') {
          const prompt = request.prompt.toLowerCase();
          log.info(`[command] Executing built-in command for: ${prompt}`);
          
          try {
            if (prompt.includes('init')) {
              await vscode.commands.executeCommand('roadie.init');
              response.markdown("Initializing Roadie... check the Output channel for progress.");
            } else if (prompt.includes('rescan')) {
              await vscode.commands.executeCommand('roadie.rescan');
              response.markdown("Scanning project... check the Output channel for details.");
            } else if (prompt.includes('reset')) {
              await vscode.commands.executeCommand('roadie.reset');
              response.markdown("Roadie state has been reset.");
            } else {
              response.markdown(`Unknown command. Try "init", "rescan", or "reset".`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error(`[command] Failed to execute: ${msg}`);
            response.markdown(`**Command failed:** ${msg}\n\nTry running it from the Command Palette instead: \`Ctrl+Shift+P\` → "Roadie: Initialize"`);
          }
          return { metadata: { command: 'system' } };
      } else {
        log.info(`No workflow for intent: ${classification.intent} — passthrough`);
        response.markdown(`**Roadie v0.10.2**\n\n**Echo:** ${request.prompt}`);
      }
      return {};
    }

    // 5. Build workflow context
    let enrichedPrompt = request.prompt;
    if (
      deps?.learningDb &&
      (classification.intent === 'onboard' || classification.intent === 'review')
    ) {
      try {
        const hotFiles = deps.learningDb.getMostEditedFiles(10);
        if (hotFiles.length > 0) {
          enrichedPrompt = buildContextWithHotFiles(request.prompt, hotFiles);
        }
      } catch {
        // Non-fatal — use original prompt
      }
    }

    // H2: Parse project conventions from CLAUDE.md
    let conventions = undefined;
    try {
      if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const parser = new ClaudeMdParser();
        conventions = await parser.parse(workspaceRoot);
        log.debug(`Parsed conventions from ${workspaceRoot}: ${conventions.techStack.length} tech items`);
      }
    } catch (err) {
      log.warn(`Failed to parse CLAUDE.md conventions: ${err instanceof Error ? err.message : String(err)}`);
    }

    const projectModel = deps?.projectModel ?? ({} as ProjectModel);
    // Store modelProvider on projectModel for InterviewerAgent access
    if (deps?.modelProvider && projectModel) {
      (projectModel as any).modelProvider = deps.modelProvider;
    }

    const workflowContext: WorkflowContext = {
      prompt:       enrichedPrompt,
      intent:       classification,
      projectModel,
      progress:     new VSCodeProgressReporter(response),
      cancellation: new VSCodeCancellationHandle(token),
      conventions,
      threadId,
    };

    // 5b. Context snapshot + level-gated logging
    _lastContextSnapshot = enrichedPrompt;
    const lensLevel = deps?.contextLensLevel ?? 'summary';
    if (lensLevel !== 'off') {
      log.info(
        `[CONTEXT] intent=${classification.intent} chars=${enrichedPrompt.length}`,
      );
      if (lensLevel === 'full') {
        const body = enrichedPrompt.length > 200
          ? `${enrichedPrompt.slice(0, 200)}…`
          : enrichedPrompt;
        log.info(`[CONTEXT] body: ${body}`);
      }
    }

    // 6. Execute workflow
    log.info(`Starting workflow: ${workflow.name}`);
    response.markdown(
      `**Roadie** detected intent: **${classification.intent}** ` +
      `(confidence: ${classification.confidence.toFixed(2)})\n\n`,
    );
    response.markdown(`Starting **${workflow.name}** workflow…\n\n`);

    // Track this workflow in the session
    _sessionManager.setWorkflow(threadId, workflow.id);

    const engine = new WorkflowEngine(new StepExecutor(stepHandler));
    const result = await engine.execute(workflow, workflowContext);
    const durationMs = Date.now() - startMs;

    const succeededSteps = result.stepResults.filter((r) => r.status === 'success').length;
    log.info(
      `Workflow complete: ${workflow.name} — ` +
      `${succeededSteps}/${result.stepResults.length} steps succeeded, ` +
      `state: ${result.state}, ${durationMs}ms`,
    );
    if (result.state === 'PAUSED' || result.state === 'WAITING_FOR_APPROVAL') {
      log.warn(`Workflow paused (step failure): ${workflow.name}`);
      if (result.pausedSessionId) {
        _sessionManager.markPaused(threadId, result.pausedSessionId);
      }
    }

    // 7. Persist outcome to LearningDatabase (if available)
    if (deps?.learningDb) {
      try {
        const failedStep = result.stepResults.find((r) => r.status === 'failed');
        deps.learningDb.recordWorkflowOutcome({
          workflowType:   workflow.id,
          prompt:         request.prompt,
          status:         result.state,
          stepsCompleted: succeededSteps,
          stepsTotal:     result.stepResults.length,
          durationMs,
          modelTiersUsed: result.modelTiersUsed.join(','),
          errorSummary:   failedStep?.error,
        });
        log.debug(`Workflow outcome persisted (${workflow.id}, ${result.state})`);
      } catch (err) {
        log.warn('Failed to persist workflow outcome', err);
      }
    }

    // 8. Stream final result
    response.markdown(`\n---\n\n${result.summary}\n\n`);
    response.markdown(
      `*Completed in ${result.duration}ms — ${result.stepResults.length} steps executed.*`,
    );

    return {};
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = new vscode.ThemeIcon('zap');
  return participant;
}

/**
 * Appends a Most-Edited Files subsection to the base context string.
 * Used for onboard and review intents to surface hot-spot files.
 */
export function buildContextWithHotFiles(
  base: string,
  hotFiles: Array<{ filePath: string; editCount: number }>,
): string {
  if (hotFiles.length === 0) return base;
  const lines = hotFiles.map((f) => `- ${f.filePath} (${f.editCount} edits)`);
  return `${base}\n\n## Most-Edited Files\n\n${lines.join('\n')}`;
}

/**
 * Check if a prompt looks like a workflow continuation (Bug 5 — clarify hardening).
 * Continuations are short, natural prompts without question marks, conversational acks, or many words.
 * This prevents real clarifications ("explain step 3?") from being misclassified as carry-over.
 */
function isLikelyWorkflowContinuationPrompt(prompt: string): boolean {
  const CONVERSATIONAL_ACK_PATTERN =
    /^(ok|okay|k|thanks|thank you|thx|got it|great|cool|nice|hello|hi|hey|yes|no|yep|nope|sure|sounds good)[!.\s]*$/i;
  const normalized = prompt.trim();
  if (normalized.length < 2 || normalized.length > 60) return false;
  if (CONVERSATIONAL_ACK_PATTERN.test(normalized)) return false;
  if (normalized.includes('?')) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length <= 8;
}

/**
 * Generate a unique thread ID when vscode.ChatContext does not provide one.
 * Fallback for threads without explicit IDs.
 *
 * @returns A unique thread identifier
 */
function generateThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * FNV-1a 32-bit hash of a string.
 */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Extract a stable thread ID from chat context by hashing the first user prompt.
 * Uses a cache to return the same ID for repeated calls with the same first prompt.
 */
export function extractThreadId(
  context: { history?: Array<{ kind?: string; prompt?: string }> },
  cache: { byFirstPromptHash: Map<number, string> },
): string {
  if (!context.history || context.history.length === 0) {
    return generateThreadId();
  }
  const firstRequest = context.history.find(
    (h) => h.kind === 'request' && typeof h.prompt === 'string',
  );
  if (!firstRequest || !firstRequest.prompt) {
    return generateThreadId();
  }
  const hash = fnv1a(firstRequest.prompt);
  const cached = cache.byFirstPromptHash.get(hash);
  if (cached) return cached;
  const id = `thread-${hash.toString(36)}`;
  cache.byFirstPromptHash.set(hash, id);
  return id;
}

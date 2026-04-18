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

const PARTICIPANT_ID = 'roadie.roadie';

/** Stores the most recent serialized context snapshot for `Roadie: Show Last Context`. */
let _lastContextSnapshot = '';

/** Global SessionManager instance — tracks conversation state across chat turns. */
const _sessionManager = new SessionManager();

/** Returns the last context snapshot written before an LLM call. */
export function getChatLastContext(): string {
  return _lastContextSnapshot;
}

/** Map intent types to workflow definitions. All 7 workflows registered. */
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

    // Extract threadId from chat context history
    const threadId = context.history && context.history.length > 0
      ? context.history[context.history.length - 1].id || generateThreadId()
      : generateThreadId();

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

      // Parse user approval: "yes" resumes, anything else aborts
      const userApproval = request.prompt.toLowerCase().trim() === 'yes';

      response.markdown(
        `**Resuming paused workflow** (${session.workflowId || 'unknown'}) ` +
        `with approval: ${userApproval ? '✓ Continue' : '✗ Abort'}\n\n`,
      );

      // TODO: Call engine.resume(session.pausedSessionId, userApproval) when resume() is available
      // For now, mark as resumed and continue workflow logic
      _sessionManager.resumeFromPaused(threadId);

      // Early return after pause handling — await engine.resume() implementation
      response.markdown(
        `*Pause resumption logic will integrate with WorkflowEngine.resume() in next iteration.*`,
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
    if (request.command && COMMAND_WORKFLOW_MAP[request.command]) {
      const intentKey = COMMAND_WORKFLOW_MAP[request.command];
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

    // 2. Check if we have a workflow for this intent
    const workflow = WORKFLOW_MAP[classification.intent];

    if (!workflow) {
      // No workflow — enriched passthrough (general_chat or unimplemented intent)
      if (classification.requiresLLM && request.model?.sendRequest) {
        log.warn(
          `Intent unclear (confidence: ${classification.confidence.toFixed(2)}) — ` +
          'treating as general_chat, delegating to LLM',
        );
        response.markdown(
          `*Intent unclear (confidence: ${classification.confidence.toFixed(2)}). Asking the LLM...*\n\n`,
        );

        try {
          const result = await request.model.sendRequest(request, [], token);
          for await (const chunk of result.text) {
            response.markdown(chunk);
          }
          return { metadata: { command: 'general_chat' } };
        } catch (err) {
          log.error(`LLM request failed: ${err instanceof Error ? err.message : String(err)}`);
          response.markdown(`**Error:** I couldn't reach the model to answer this question. Please try again.`);
          return { metadata: { command: 'general_chat' } };
        }
      } else {
        log.info('No workflow for intent: general_chat — passthrough');
        response.markdown(`**Echo:** ${request.prompt}`);
      }
      return {};
    }

    // 3. Build workflow context
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

    const workflowContext: WorkflowContext = {
      prompt:       enrichedPrompt,
      intent:       classification,
      projectModel: (deps?.projectModel ?? {}) as ProjectModel,
      progress:     new VSCodeProgressReporter(response),
      cancellation: new VSCodeCancellationHandle(token),
    };

    // 3b. Context snapshot + level-gated logging
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

    // 4. Execute workflow
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
      // TODO: When engine.getPausedSessions() is available, extract sessionId and call:
      // const pausedSessionId = engine.getLastPausedSessionId();
      // _sessionManager.markPaused(threadId, pausedSessionId);
    }

    // 5. Persist outcome to LearningDatabase (if available)
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

    // 6. Stream final result
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
 * Generate a unique thread ID when vscode.ChatContext does not provide one.
 * Fallback for threads without explicit IDs.
 *
 * @returns A unique thread identifier
 */
function generateThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

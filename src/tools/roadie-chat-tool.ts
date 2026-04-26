/**
 * @module roadie-chat-tool
 * @description MCP tool handler for chat-native intent dispatch.
 *   Accepts a message, classifies intent, dispatches to WorkflowEngine,
 *   streams progress, and returns structured results.
 * @inputs { message: string; sessionId?: string }
 * @outputs { summary: string; files_changed: string[]; next_action?: string }
 * @depends-on IntentClassifier, WorkflowEngine, workflow definitions
 */

import { z } from 'zod';
import type {
  IntentClassifier,
  WorkflowDefinition,
  WorkflowContext,
  WorkflowResult,
} from '../types';
import type { ProgressReporter, CancellationHandle } from '../providers';
import { WorkflowEngine } from '../engine/workflow-engine';
import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';

/**
 * Input schema for roadie_chat tool.
 */
export const RoadieChatInputSchema = z.object({
  message: z.string().describe('The user message to process'),
  sessionId: z.string().optional().describe('Optional session ID for resuming interrupted workflows'),
  explain: z.boolean().optional().describe('If true, include rationale for workflow/model/skill choices in the response'),
});

export type RoadieChatInput = z.infer<typeof RoadieChatInputSchema>;

/**
 * Output schema for roadie_chat tool.
 */
export const RoadieChatOutputSchema = z.object({
  summary: z.string().describe('Summary of workflow execution'),
  files_changed: z.array(z.string()).describe('List of files changed'),
  next_action: z.string().optional().describe('Optional next action suggestion'),
  rationale: z.string().optional().describe('Explain-mode: why this workflow/model/skill was chosen'),
  progress_steps: z.array(z.string()).optional().describe('Ordered list of progress updates from execution'),
  sessionId: z.string().optional().describe('Session ID to pass back on the next turn when a workflow is paused awaiting approval'),
});

export type RoadieChatOutput = z.infer<typeof RoadieChatOutputSchema>;

/**
 * Optional callback for streaming MCP progress notifications.
 * Receives step name and index for streaming to host-AI.
 */
export type ProgressNotifier = (stepName: string, stepIndex: number, total: number) => void;

/**
 * Handler for the roadie_chat MCP tool.
 * Orchestrates: intent classification → workflow dispatch → progress streaming → result formatting.
 */
export async function handleRoadieChat(
  params: RoadieChatInput,
  classifier: IntentClassifier,
  engine: WorkflowEngine,
  workflowDefs: Map<string, WorkflowDefinition>,
  log: Logger = STUB_LOGGER,
  onProgress?: ProgressNotifier,
): Promise<RoadieChatOutput> {
  const { message, sessionId, explain } = params;

  log.info(`[roadie_chat] Received: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);

  // --- Resume path: sessionId provided and a paused workflow exists for it ---
  if (sessionId && engine.hasPausedSession(sessionId)) {
    const progressUpdates: string[] = [];
    let stepCounter = 0;
    const progress: ProgressReporter = {
      report: (msg: string) => {
        progressUpdates.push(msg);
        log.debug(`[roadie_chat:progress] ${msg}`);
        if (onProgress) onProgress(msg, ++stepCounter, 0);
      },
      reportMarkdown: (md: string) => {
        progressUpdates.push(md);
        log.debug(`[roadie_chat:progress:md] ${md}`);
      },
    };
    const cancellation: CancellationHandle = { isCancelled: false, onCancelled: () => {} };

    engine.rebindTurnHandles(sessionId, { progress, cancellation });

    const userApproval = /\byes\b|\bapprove\b|\bcontinue\b|\bproceed\b/i.test(message);
    log.info(`[roadie_chat] Resuming session ${sessionId}, approval=${userApproval}`);

    let resumeResult: WorkflowResult;
    try {
      resumeResult = await engine.resume(sessionId, userApproval);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`[roadie_chat] Resume failed: ${error}`);
      return {
        summary: `Roadie failed to resume workflow: ${error}`,
        files_changed: [],
        next_action: 'Please try again.',
      };
    }

    const filesChanged = new Set<string>();
    for (const stepResult of resumeResult.stepResults) {
      const fileMatches = stepResult.output.match(/(?:file:\/\/|src\/)[^\s]+/g) || [];
      fileMatches.forEach((f) => filesChanged.add(f));
    }

    return {
      summary: resumeResult.summary ?? buildSummary(resumeResult, progressUpdates, 1),
      files_changed: Array.from(filesChanged),
      next_action: suggestNextAction(resumeResult, resumeResult.workflowId),
      progress_steps: progressUpdates.length > 0 ? progressUpdates : undefined,
      sessionId: resumeResult.pausedSessionId,
    };
  }

  // Step 1: Classify intent
  const classification = classifier.classify(message);
  log.debug(`[roadie_chat] Classification: ${classification.intent} (confidence: ${classification.confidence.toFixed(2)})`);

  // Step 2: Determine workflow from intent
  const intentType = classification.intent;
  const workflow = workflowDefs.get(intentType);

  if (!workflow) {
    const errorMsg = `No workflow found for intent: ${intentType}`;
    log.warn(`[roadie_chat] ${errorMsg}`);
    return {
      summary: `Roadie could not find a workflow for intent "${intentType}". Returning to chat.`,
      files_changed: [],
      next_action: 'Try describing your request more specifically.',
    };
  }

  // Step 3: Create progress reporter and cancellation handle
  const progressUpdates: string[] = [];
  let stepCounter = 0;
  const totalSteps = workflow.steps.length;
  const progress: ProgressReporter = {
    report: (msg: string) => {
      progressUpdates.push(msg);
      log.debug(`[roadie_chat:progress] ${msg}`);
      // Stream MCP progress notification if callback provided
      if (onProgress) {
        onProgress(msg, ++stepCounter, totalSteps);
      }
    },
    reportMarkdown: (md: string) => {
      progressUpdates.push(md);
      log.debug(`[roadie_chat:progress:md] ${md}`);
    },
  };

  const cancellation: CancellationHandle = {
    isCancelled: false,
    onCancelled: () => {},
  };

  // Step 4: Build workflow context
  const context: WorkflowContext = {
    prompt: message,
    intent: classification,
    projectModel: {} as WorkflowContext['projectModel'], // TODO: Initialize from container
    progress,
    cancellation,
    isAutonomous: false,
    previousStepResults: [],
  };

  // Step 5: Execute workflow
  log.info(`[roadie_chat] Dispatching workflow: ${workflow.name}`);
  let result: WorkflowResult;

  try {
    result = await engine.execute(workflow, context);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`[roadie_chat] Workflow execution failed: ${error}`);
    return {
      summary: `Roadie encountered an error: ${error}`,
      files_changed: [],
      next_action: 'Please try again or provide more context.',
    };
  }

  // Step 6: Extract files changed from step results
  const filesChanged = new Set<string>();
  for (const stepResult of result.stepResults) {
    // Parse filenames from step output (heuristic: look for file:// URIs or paths)
    const fileMatches = stepResult.output.match(/(?:file:\/\/|src\/)[^\s]+/g) || [];
    fileMatches.forEach((f) => filesChanged.add(f));
  }

  // Step 7: Format response
  const summary = buildSummary(result, progressUpdates, classification.confidence);
  const nextAction = suggestNextAction(result, intentType);

  const output: RoadieChatOutput = {
    summary,
    files_changed: Array.from(filesChanged),
    next_action: nextAction,
    progress_steps: progressUpdates.length > 0 ? progressUpdates : undefined,
    sessionId: result.pausedSessionId,
  };

  // Explain mode: attach rationale for workflow/model/skill choices
  if (explain) {
    const tiersUsed = result.modelTiersUsed?.join(', ') || 'unknown';
    output.rationale = [
      `Intent classified as "${intentType}" with ${(classification.confidence * 100).toFixed(0)}% confidence.`,
      `Matched signals: ${classification.signals.slice(0, 5).join(', ') || 'none'}.`,
      `Dispatched to "${workflow.name}" workflow (${workflow.steps.length} steps).`,
      `Model tiers used: ${tiersUsed}.`,
      classification.requiresLLM ? 'LLM fallback classification was triggered (local confidence < 0.7).' : 'Local classifier was sufficient (no LLM fallback needed).',
    ].join(' ');
  }

  log.info(`[roadie_chat] Completed: ${output.summary}`);
  return output;
}

/**
 * Build a human-readable summary from workflow result and progress.
 */
function buildSummary(result: WorkflowResult, progressUpdates: string[], confidence: number): string {
  const { state, stepResults, duration } = result;
  const succeeded = stepResults.filter((r) => r.status === 'success').length;
  const total = stepResults.length;

  const lines: string[] = [];
  lines.push(`Workflow ${state}. ${succeeded}/${total} steps succeeded.`);

  if (progressUpdates.length > 0) {
    lines.push(`Progress: ${progressUpdates.slice(-2).join(' → ')}`);
  }

  if (duration) {
    lines.push(`Completed in ${(duration / 1000).toFixed(1)}s.`);
  }

  if (confidence < 0.5) {
    lines.push('⚠️ Low confidence classification — result may not match intent.');
  }

  return lines.join(' ');
}

/**
 * Suggest a next action based on workflow state and intent.
 */
function suggestNextAction(result: WorkflowResult, intentType: string): string | undefined {
  const { state, stepResults } = result;

  // If workflow failed, suggest clarification
  if (state === 'FAILED' || state === 'PAUSED') {
    return `The ${intentType} workflow encountered a blocking issue. Provide more context or clarify your request.`;
  }

  // If workflow completed, suggest follow-up actions based on intent
  const failedSteps = stepResults.filter((r) => r.status === 'failed');
  if (failedSteps.length > 0) {
    return `Some steps failed. Consider reviewing the errors above or asking for help.`;
  }

  // Success case
  if (state === 'COMPLETED') {
    if (intentType === 'bug_fix') {
      return 'Bug fix complete. Run tests to verify.';
    }
    if (intentType === 'feature') {
      return 'Feature skeleton created. Add business logic and tests.';
    }
    if (intentType === 'refactor') {
      return 'Refactor complete. Review changes and run full test suite.';
    }
  }

  return undefined;
}

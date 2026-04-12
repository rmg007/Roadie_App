/**
 * @module chat-participant
 * @description Registers the @roadie Chat Participant with VS Code.
 *   Routes developer messages through intent classification, then
 *   dispatches to the appropriate workflow via WorkflowEngine.
 *   Step 2: Echo handler. Step 9: Bug fix routing. Steps 11+: All workflows.
 * @inputs Developer chat messages via VS Code Chat Participant API
 * @outputs Streamed markdown responses to the chat UI
 * @depends-on vscode, intent-classifier, workflow-engine, project-model
 * @depended-on-by extension.ts (registration at activation)
 */

import * as vscode from 'vscode';
import type { WorkflowDefinition, WorkflowContext, ProjectModel } from '../types';
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

const PARTICIPANT_ID = 'roadie';

/** Map intent types to workflow definitions. All 7 workflows registered. */
const WORKFLOW_MAP: Record<string, WorkflowDefinition> = {
  bug_fix: BUG_FIX_WORKFLOW,
  feature: FEATURE_WORKFLOW,
  refactor: REFACTOR_WORKFLOW,
  review: REVIEW_WORKFLOW,
  document: DOCUMENT_WORKFLOW,
  dependency: DEPENDENCY_WORKFLOW,
  onboard: ONBOARD_WORKFLOW,
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
}): vscode.Disposable {
  const classifier = deps?.classifier ?? new IntentClassifier();

  // Default step handler — placeholder until AgentSpawner is wired (Step 7+)
  const stepHandler: StepHandlerFn = deps?.stepHandler ?? (async (step) => ({
    stepId: step.id,
    status: 'success' as const,
    output: `[Placeholder] Step "${step.name}" would execute here with AgentSpawner.`,
    tokenUsage: { input: 0, output: 0 },
    attempts: 1,
    modelUsed: 'placeholder',
  }));

  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult> => {
    // 1. Classify intent
    const classification = classifier.classify(request.prompt);

    // 2. Check if we have a workflow for this intent
    const workflow = WORKFLOW_MAP[classification.intent];

    if (!workflow) {
      // No workflow — enriched passthrough (general_chat or unimplemented intent)
      if (classification.requiresLLM) {
        response.markdown(`*Intent unclear (confidence: ${classification.confidence.toFixed(2)}). Treating as general chat.*\n\n`);
      }
      response.markdown(`**Echo:** ${request.prompt}`);
      return {};
    }

    // 3. Build workflow context
    const workflowContext: WorkflowContext = {
      prompt: request.prompt,
      intent: classification,
      projectModel: (deps?.projectModel ?? {}) as ProjectModel,
      chatResponseStream: response,
      cancellationToken: token,
    };

    // 4. Execute workflow
    response.markdown(`**Roadie** detected intent: **${classification.intent}** (confidence: ${classification.confidence.toFixed(2)})\n\n`);
    response.markdown(`Starting **${workflow.name}** workflow...\n\n`);

    const engine = new WorkflowEngine(new StepExecutor(stepHandler));
    const result = await engine.execute(workflow, workflowContext);

    // 5. Stream final result
    response.markdown(`\n---\n\n${result.summary}\n\n`);
    response.markdown(`*Completed in ${result.duration}ms — ${result.stepResults.length} steps executed.*`);

    return {};
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = new vscode.ThemeIcon('zap');
  return participant;
}

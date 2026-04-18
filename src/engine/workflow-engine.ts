/**
 * @module workflow-engine
 * @description Finite state machine that executes multi-step workflows.
 *   Accepts a WorkflowDefinition and WorkflowContext, traverses steps
 *   sequentially, streams progress, manages state transitions, and
 *   respects CancellationToken at every step boundary.
 *   Parallel steps (via Promise.allSettled) are supported for step
 *   type 'parallel' with branches.
 * @inputs WorkflowDefinition, WorkflowContext
 * @outputs WorkflowResult
 * @depends-on step-executor.ts, types.ts, shell/logger.ts
 * @depended-on-by shell/chat-participant.ts (workflow dispatch)
 */

import type {
  WorkflowDefinition,
  WorkflowContext,
  WorkflowResult,
  WorkflowStep,
  StepResult,
  ModelTier,
  PausedWorkflowSession,
  QuestionStepConfig,
} from '../types';
import { WorkflowState } from '../types';
import { StepExecutor } from './step-executor';
import { getLogger } from '../shell/logger';

export class WorkflowEngine {
  private state: WorkflowState = WorkflowState.PENDING;
  private stepExecutor: StepExecutor;
  /** Session storage for paused workflows keyed by sessionId */
  private pausedSessions: Map<string, PausedWorkflowSession> = new Map();

  constructor(stepExecutor: StepExecutor) {
    this.stepExecutor = stepExecutor;
  }

  /** Current workflow state (for testing / status queries). */
  getState(): WorkflowState {
    return this.state;
  }

  /**
   * Execute a complete workflow.
   *
   * State transitions:
   *   PENDING -> RUNNING -> [RETRYING | WAITING_PARALLEL]
   *   -> COMPLETED | PAUSED | FAILED | CANCELLED
   */
  async execute(
    definition: WorkflowDefinition,
    context: WorkflowContext,
  ): Promise<WorkflowResult> {
    const log = getLogger();
    if (!definition.steps || definition.steps.length === 0) {
      throw new Error(`Workflow '${definition.id}' has no steps defined.`);
    }
    const totalSteps = definition.steps.length;

    this.transition(definition.id, WorkflowState.PENDING, WorkflowState.RUNNING, log);

    const stepResults: StepResult[] = [];
    const tiersUsed = new Set<ModelTier>();
    const startTime = Date.now();

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      if (step === undefined) continue;

      // Check cancellation at step boundary
      if (context.cancellation.isCancelled) {
        this.transition(definition.id, this.state, WorkflowState.CANCELLED, log);
        log.info(`[${definition.id}] Cancelled before step ${i + 1}/${totalSteps}: "${step.name}"`);
        break;
      }

      log.info(`[${definition.id}] Step ${i + 1}/${totalSteps}: "${step.name}" — starting`);

      // Stream progress to chat
      context.progress.report(`Running: ${step.name}…`);

      // Execute step (sequential, parallel, or question)
      let result: StepResult;
      const stepStart = Date.now();

      if (step.type === 'question') {
        result = await this.executeQuestionStep(step, context);
      } else if (step.type === 'parallel' && step.branches && step.branches.length > 0) {
        this.transition(definition.id, this.state, WorkflowState.WAITING_PARALLEL, log);
        log.info(`[${definition.id}] Parallel branches: ${step.branches.length}`);
        result = await this.executeParallelBranches(step, context, tiersUsed);
      } else {
        result = await this.stepExecutor.executeStep(step, context);
      }

      const stepMs = Date.now() - stepStart;
      stepResults.push(result);

      // Track model tier
      if (result.modelUsed) {
        tiersUsed.add(step.modelTier);
      }

      // Thread results to next step
      context.previousStepResults = [...stepResults];

      // Handle step failure
      if (result.status === 'failed') {
        this.transition(definition.id, this.state, WorkflowState.PAUSED, log);
        log.warn(
          `[${definition.id}] Step ${i + 1}/${totalSteps}: "${step.name}" — ` +
          `FAILED after ${result.attempts} attempt(s), ${stepMs}ms` +
          (result.error ? ` — ${result.error}` : ''),
        );
        break;
      }

      log.info(
        `[${definition.id}] Step ${i + 1}/${totalSteps}: "${step.name}" — ` +
        `done (${result.status}, ${result.attempts} attempt(s), ` +
        `model: ${result.modelUsed || 'n/a'}, ${stepMs}ms)`,
      );

      // Check if step requires approval
      if (step.requiresApproval === true) {
        const sessionId = `${definition.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        this.transition(definition.id, this.state, WorkflowState.WAITING_FOR_APPROVAL, log);

        // Save session snapshot
        this.pausedSessions.set(sessionId, {
          sessionId,
          workflowId: definition.id,
          currentStepIndex: i,
          definition,
          context,
          stepResults: [...stepResults],
          modelTiersUsed: [...tiersUsed],
          timestamp: new Date(),
        });

        log.info(
          `[${definition.id}] Step ${i + 1}/${totalSteps} paused — ` +
          `requires approval. Session ID: ${sessionId}`,
        );

        // Stream approval prompt to chat
        context.progress.report(
          `**Proceed with "${step.name}"?** Reply \`yes\` to continue or \`no\` to abort. (Session: ${sessionId})`,
        );

        // Return early; caller will invoke resume() with user approval
        return {
          workflowId: definition.id,
          state: WorkflowState.WAITING_FOR_APPROVAL,
          stepResults,
          duration: Date.now() - startTime,
          modelTiersUsed: [...tiersUsed],
          summary: `Workflow '${definition.name}': ${stepResults.length}/${totalSteps} steps completed, awaiting approval on "${step.name}". Session: ${sessionId}`,
        };
      }

      // Back to RUNNING for next step
      this.state = WorkflowState.RUNNING;
    }

    // Final state
    if (this.state === WorkflowState.RUNNING) {
      this.transition(definition.id, this.state, WorkflowState.COMPLETED, log);
    }

    const totalMs = Date.now() - startTime;
    const succeeded = stepResults.filter((r) => r.status === 'success').length;
    log.info(
      `[${definition.id}] Final state: ${this.state} — ` +
      `${succeeded}/${stepResults.length} steps, ${totalMs}ms`,
    );

    const workflowResult: WorkflowResult = {
      workflowId:      definition.id,
      state:           this.state,
      stepResults,
      duration:        totalMs,
      modelTiersUsed:  [...tiersUsed],
      summary:         this.buildSummary(definition, stepResults),
    };

    // Call onComplete hook if defined and workflow completed
    if (this.state === WorkflowState.COMPLETED && definition.onComplete) {
      try {
        return await definition.onComplete(stepResults);
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        getLogger().warn(`Workflow onComplete hook failed: ${error}`, err);
        return workflowResult;
      }
    }

    return workflowResult;
  }

  /** Execute parallel branches via Promise.allSettled. */
  private async executeParallelBranches(
    step: WorkflowStep,
    context: WorkflowContext,
    tiersUsed: Set<ModelTier>,
  ): Promise<StepResult> {
    const log = getLogger();
    const branches = step.branches!;

    log.debug(`[parallel] Spawning ${branches.length} branches: [${branches.map((b) => b.id).join(', ')}]`);

    const results = await Promise.allSettled(
      branches.map((branch) => {
        const branchContext = { ...context };
        if (context.previousStepResults) {
          branchContext.previousStepResults = [...context.previousStepResults];
        } else {
          delete branchContext.previousStepResults;
        }
        return this.stepExecutor.executeStep(branch, branchContext);
      }),
    );

    const branchResults: StepResult[] = [];
    let anyFailed = false;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r === undefined) continue;
      const branch = branches[i];
      if (branch === undefined) continue;
      if (r.status === 'fulfilled') {
        branchResults.push(r.value);
        if (r.value.modelUsed) tiersUsed.add(branch.modelTier);
        if (r.value.status === 'failed') {
          anyFailed = true;
          log.warn(`[parallel] Branch "${branch.id}" failed: ${r.value.error ?? '(no detail)'}`);
        } else {
          log.debug(`[parallel] Branch "${branch.id}" succeeded`);
        }
      } else {
        anyFailed = true;
        const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        log.warn(`[parallel] Branch "${branch.id}" rejected: ${errMsg}`);
        branchResults.push({
          stepId:     branch.id,
          status:     'failed',
          output:     '',
          tokenUsage: { input: 0, output: 0 },
          attempts:   1,
          modelUsed:  '',
          error:      errMsg,
        });
      }
    }

    const passed = branchResults.filter((r) => r.status === 'success').length;
    log.info(`[parallel] ${passed}/${branches.length} branches succeeded`);

    // Aggregate into a single StepResult for the parent parallel step
    return {
      stepId:     step.id,
      status:     anyFailed ? 'failed' : 'success',
      output:     branchResults.map((r) => r.output).join('\n---\n'),
      toolResults: branchResults.flatMap((r) => r.toolResults ?? []),
      tokenUsage: {
        input:  branchResults.reduce((sum, r) => sum + r.tokenUsage.input, 0),
        output: branchResults.reduce((sum, r) => sum + r.tokenUsage.output, 0),
      },
      attempts:  1,
      modelUsed: branchResults.map((r) => r.modelUsed).join(', '),
    };
  }

  /**
   * Execute a question step that prompts for user input.
   * Stores the response in context[responseField] for later steps to use.
   */
  private async executeQuestionStep(
    step: any,
    context: WorkflowContext,
  ): Promise<StepResult> {
    const log = getLogger();
    const config = step as QuestionStepConfig & { id: string; name: string };

    log.info(`[question] Step "${config.id}": prompting for "${config.responseField}"`);

    // For now, return a placeholder result indicating the question was asked
    // In production, this would integrate with the chat UI to capture user input
    const placeholderResponse = `[Question posed: ${config.prompt}]`;
    context[config.responseField] = placeholderResponse;

    return {
      stepId: config.id,
      status: 'success',
      output: `Question asked and awaiting response: ${config.prompt}`,
      tokenUsage: { input: 0, output: 0 },
      attempts: 1,
      modelUsed: 'question-input',
    };
  }

  private buildSummary(definition: WorkflowDefinition, results: StepResult[]): string {
    const succeeded = results.filter((r) => r.status === 'success').length;
    const total = results.length;
    return `Workflow '${definition.name}': ${succeeded}/${total} steps completed. State: ${this.state}`;
  }

  /**
   * Resume a paused workflow from a previous approval checkpoint.
   *
   * @param sessionId The session ID returned when workflow paused
   * @param userApproval true to continue, false to cancel
   * @returns Updated WorkflowResult (either COMPLETED, CANCELLED, or WAITING_FOR_APPROVAL again)
   */
  async resume(
    sessionId: string,
    userApproval: boolean,
  ): Promise<WorkflowResult> {
    const log = getLogger();
    const session = this.pausedSessions.get(sessionId);

    if (!session) {
      const error = `Session not found: ${sessionId}`;
      log.error(error);
      throw new Error(error);
    }

    const {
      workflowId,
      definition,
      context,
      currentStepIndex,
      stepResults,
      modelTiersUsed,
    } = session;

    log.info(`[${workflowId}] Resuming from session ${sessionId}, approval: ${userApproval}`);

    // Clean up the paused session
    this.pausedSessions.delete(sessionId);

    // If user rejected, cancel workflow
    if (!userApproval) {
      this.transition(workflowId, this.state, WorkflowState.CANCELLED, log);
      log.info(`[${workflowId}] Workflow cancelled by user at step ${currentStepIndex + 1}`);

      return {
        workflowId,
        state: WorkflowState.CANCELLED,
        stepResults,
        duration: Date.now() - (session.timestamp?.getTime() || 0),
        modelTiersUsed: [...modelTiersUsed],
        summary: `Workflow '${definition.name}' cancelled by user after step ${currentStepIndex + 1}`,
      };
    }

    // User approved, continue from next step
    this.transition(workflowId, this.state, WorkflowState.RUNNING, log);
    const totalSteps = definition.steps.length;
    const tiersUsed = new Set<ModelTier>(modelTiersUsed);
    const resumeStartTime = Date.now();

    for (let i = currentStepIndex + 1; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      if (step === undefined) continue;

      // Check cancellation at step boundary
      if (context.cancellation.isCancelled) {
        this.transition(workflowId, this.state, WorkflowState.CANCELLED, log);
        log.info(
          `[${workflowId}] Cancelled during resume at step ${i + 1}/${totalSteps}: "${step.name}"`,
        );
        break;
      }

      log.info(
        `[${workflowId}] Step ${i + 1}/${totalSteps}: "${step.name}" — starting (resumed)`,
      );

      // Stream progress to chat
      context.progress.report(`Running: ${step.name}…`);

      // Execute step (sequential, parallel, or question)
      let result: StepResult;
      const stepStart = Date.now();

      if (step.type === 'question') {
        result = await this.executeQuestionStep(step, context);
      } else if (step.type === 'parallel' && step.branches && step.branches.length > 0) {
        this.transition(workflowId, this.state, WorkflowState.WAITING_PARALLEL, log);
        log.info(`[${workflowId}] Parallel branches: ${step.branches.length}`);
        result = await this.executeParallelBranches(step, context, tiersUsed);
      } else {
        result = await this.stepExecutor.executeStep(step, context);
      }

      const stepMs = Date.now() - stepStart;
      stepResults.push(result);

      // Track model tier
      if (result.modelUsed) {
        tiersUsed.add(step.modelTier);
      }

      // Thread results to next step
      context.previousStepResults = [...stepResults];

      // Handle step failure
      if (result.status === 'failed') {
        this.transition(workflowId, this.state, WorkflowState.PAUSED, log);
        log.warn(
          `[${workflowId}] Step ${i + 1}/${totalSteps}: "${step.name}" — ` +
          `FAILED after ${result.attempts} attempt(s), ${stepMs}ms` +
          (result.error ? ` — ${result.error}` : ''),
        );
        break;
      }

      log.info(
        `[${workflowId}] Step ${i + 1}/${totalSteps}: "${step.name}" — ` +
        `done (${result.status}, ${result.attempts} attempt(s), ` +
        `model: ${result.modelUsed || 'n/a'}, ${stepMs}ms)`,
      );

      // Check if step requires approval
      if (step.requiresApproval === true) {
        const newSessionId = `${workflowId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        this.transition(workflowId, this.state, WorkflowState.WAITING_FOR_APPROVAL, log);

        // Save new session snapshot
        this.pausedSessions.set(newSessionId, {
          sessionId: newSessionId,
          workflowId,
          currentStepIndex: i,
          definition,
          context,
          stepResults: [...stepResults],
          modelTiersUsed: [...tiersUsed],
          timestamp: new Date(),
        });

        log.info(
          `[${workflowId}] Step ${i + 1}/${totalSteps} paused — ` +
          `requires approval. Session ID: ${newSessionId}`,
        );

        // Stream approval prompt to chat
        context.progress.report(
          `**Proceed with "${step.name}"?** Reply \`yes\` to continue or \`no\` to abort. (Session: ${newSessionId})`,
        );

        // Return with new session
        return {
          workflowId,
          state: WorkflowState.WAITING_FOR_APPROVAL,
          stepResults,
          duration: Date.now() - resumeStartTime,
          modelTiersUsed: [...tiersUsed],
          summary: `Workflow '${definition.name}': ${stepResults.length}/${totalSteps} steps completed, awaiting approval on "${step.name}". Session: ${newSessionId}`,
        };
      }

      // Back to RUNNING for next step
      this.state = WorkflowState.RUNNING;
    }

    // Final state
    if (this.state === WorkflowState.RUNNING) {
      this.transition(workflowId, this.state, WorkflowState.COMPLETED, log);
    }

    const totalMs = Date.now() - resumeStartTime;
    const succeeded = stepResults.filter((r) => r.status === 'success').length;
    log.info(
      `[${workflowId}] Final state (resumed): ${this.state} — ` +
      `${succeeded}/${stepResults.length} steps, ${totalMs}ms`,
    );

    const workflowResult: WorkflowResult = {
      workflowId,
      state: this.state,
      stepResults,
      duration: totalMs,
      modelTiersUsed: [...tiersUsed],
      summary: this.buildSummary(definition, stepResults),
    };

    // Call onComplete hook if defined and workflow completed
    if (this.state === WorkflowState.COMPLETED && definition.onComplete) {
      try {
        return await definition.onComplete(stepResults);
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        getLogger().warn(`Workflow onComplete hook failed: ${error}`, err);
        return workflowResult;
      }
    }

    return workflowResult;
  }

  private transition(
    workflowId: string,
    from: WorkflowState,
    to: WorkflowState,
    log: ReturnType<typeof getLogger>,
  ): void {
    log.debug(`[${workflowId}] ${from} → ${to}`);
    this.state = to;
  }
}

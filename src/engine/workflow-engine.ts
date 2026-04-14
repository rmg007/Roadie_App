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
} from '../types';
import { WorkflowState } from '../types';
import { StepExecutor } from './step-executor';
import { getLogger } from '../shell/logger';

export class WorkflowEngine {
  private state: WorkflowState = WorkflowState.PENDING;
  private stepExecutor: StepExecutor;

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
    const totalSteps = definition.steps.length;

    this.transition(definition.id, WorkflowState.PENDING, WorkflowState.RUNNING, log);

    const stepResults: StepResult[] = [];
    const tiersUsed = new Set<ModelTier>();
    const startTime = Date.now();

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];

      // Check cancellation at step boundary
      if (context.cancellation.isCancelled) {
        this.transition(definition.id, this.state, WorkflowState.CANCELLED, log);
        log.info(`[${definition.id}] Cancelled before step ${i + 1}/${totalSteps}: "${step.name}"`);
        break;
      }

      log.info(`[${definition.id}] Step ${i + 1}/${totalSteps}: "${step.name}" — starting`);

      // Stream progress to chat
      context.progress.report(`Running: ${step.name}…`);

      // Execute step (sequential or parallel branches)
      let result: StepResult;
      const stepStart = Date.now();

      if (step.type === 'parallel' && step.branches && step.branches.length > 0) {
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
      return definition.onComplete(stepResults);
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
      branches.map((branch) => this.stepExecutor.executeStep(branch, context)),
    );

    const branchResults: StepResult[] = [];
    let anyFailed = false;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        branchResults.push(r.value);
        if (r.value.modelUsed) tiersUsed.add(branches[i].modelTier);
        if (r.value.status === 'failed') {
          anyFailed = true;
          log.warn(`[parallel] Branch "${branches[i].id}" failed: ${r.value.error ?? '(no detail)'}`);
        } else {
          log.debug(`[parallel] Branch "${branches[i].id}" succeeded`);
        }
      } else {
        anyFailed = true;
        const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        log.warn(`[parallel] Branch "${branches[i].id}" rejected: ${errMsg}`);
        branchResults.push({
          stepId:     branches[i].id,
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

  private buildSummary(definition: WorkflowDefinition, results: StepResult[]): string {
    const succeeded = results.filter((r) => r.status === 'success').length;
    const total = results.length;
    return `Workflow '${definition.name}': ${succeeded}/${total} steps completed. State: ${this.state}`;
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

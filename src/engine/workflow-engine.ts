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
 * @depends-on step-executor.ts, types.ts
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
    this.state = WorkflowState.RUNNING;
    const stepResults: StepResult[] = [];
    const tiersUsed = new Set<ModelTier>();
    const startTime = Date.now();

    for (const step of definition.steps) {
      // Check cancellation at step boundary
      if (context.cancellationToken.isCancellationRequested) {
        this.state = WorkflowState.CANCELLED;
        break;
      }

      // Stream progress
      context.chatResponseStream.progress(`Running: ${step.name}...`);

      // Execute step (sequential or parallel branches)
      let result: StepResult;

      if (step.type === 'parallel' && step.branches && step.branches.length > 0) {
        this.state = WorkflowState.WAITING_PARALLEL;
        result = await this.executeParallelBranches(step, context, tiersUsed);
      } else {
        result = await this.stepExecutor.executeStep(step, context);
      }

      stepResults.push(result);

      // Track model tier
      if (result.modelUsed) {
        tiersUsed.add(step.modelTier);
      }

      // Thread results to next step
      context.previousStepResults = [...stepResults];

      // Handle step failure
      if (result.status === 'failed') {
        this.state = WorkflowState.PAUSED;
        break;
      }

      // Back to RUNNING for next step
      this.state = WorkflowState.RUNNING;
    }

    // Final state
    if (this.state === WorkflowState.RUNNING) {
      this.state = WorkflowState.COMPLETED;
    }

    const workflowResult: WorkflowResult = {
      workflowId: definition.id,
      state: this.state,
      stepResults,
      duration: Date.now() - startTime,
      modelTiersUsed: [...tiersUsed],
      summary: this.buildSummary(definition, stepResults),
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
    const branches = step.branches!;
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
        if (r.value.status === 'failed') anyFailed = true;
      } else {
        anyFailed = true;
        branchResults.push({
          stepId: branches[i].id,
          status: 'failed',
          output: '',
          tokenUsage: { input: 0, output: 0 },
          attempts: 1,
          modelUsed: '',
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }

    // Aggregate into a single StepResult for the parent parallel step
    return {
      stepId: step.id,
      status: anyFailed ? 'failed' : 'success',
      output: branchResults.map((r) => r.output).join('\n---\n'),
      toolResults: branchResults.flatMap((r) => r.toolResults ?? []),
      tokenUsage: {
        input: branchResults.reduce((sum, r) => sum + r.tokenUsage.input, 0),
        output: branchResults.reduce((sum, r) => sum + r.tokenUsage.output, 0),
      },
      attempts: 1,
      modelUsed: branchResults.map((r) => r.modelUsed).join(', '),
    };
  }

  private buildSummary(definition: WorkflowDefinition, results: StepResult[]): string {
    const succeeded = results.filter((r) => r.status === 'success').length;
    const total = results.length;
    return `Workflow '${definition.name}': ${succeeded}/${total} steps completed. State: ${this.state}`;
  }
}

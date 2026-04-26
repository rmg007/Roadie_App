/**
 * @module step-executor
 * @description Executes individual workflow steps with retry and escalation.
 *   Attempt 1: original tier + prompt. Attempt 2: same tier, refined prompt
 *   with error context. Attempt 3+: escalated tier. After maxRetries+1
 *   total attempts, returns failed status (workflow engine transitions to PAUSED).
 *   Enforces per-step timeout via Promise.race.
 * @inputs WorkflowStep, WorkflowContext, StepHandlerFn
 * @outputs StepResult
 * @depends-on types.ts (WorkflowStep, StepResult, ModelTier), shell/logger.ts
 * @depended-on-by workflow-engine.ts
 */

import {
  DEFAULT_WORKFLOW_EXECUTION_POLICY,
  type WorkflowStep,
  type WorkflowContext,
  type StepResult,
  type ModelTier,
  type StepFailureReason,
} from '../types';
import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';
import { getConfig } from '../config-loader';

/**
 * Callback invoked by StepExecutor for each attempt.
 * In Phase 1 Step 6, tests provide a mock. Step 7 wires this to AgentSpawner.
 */
export type StepHandlerFn = (
  step: WorkflowStep,
  context: WorkflowContext,
  attemptInfo: { attempt: number; tier: ModelTier; previousError?: string },
) => Promise<StepResult>;

const MIN_STEP_TIMEOUT_MS = 1_000;

function resolveContextProjectRoot(context: WorkflowContext): string | undefined {
  const projectModel = context.projectModel as Partial<WorkflowContext['projectModel']>;
  if (typeof projectModel.getDirectoryTree === 'function') {
    const directoryTree = projectModel.getDirectoryTree();
    if (directoryTree?.path) {
      return directoryTree.path;
    }
  }

  if (typeof projectModel.getDirectoryStructure === 'function') {
    const directoryStructure = projectModel.getDirectoryStructure();
    if (directoryStructure?.path) {
      return directoryStructure.path;
    }
  }

  return undefined;
}

/** Check if dry-run mode is enabled for the active workflow context. */
function isDryRun(context: WorkflowContext): boolean {
  const projectRoot = resolveContextProjectRoot(context);
  if (projectRoot) {
    return getConfig(projectRoot).dryRun;
  }

  return process.env.ROADIE_DRY_RUN === '1' || process.env.ROADIE_DRY_RUN === 'true';
}

/** Escalate to the next model tier. Premium cannot escalate further. */
function escalateTier(tier: ModelTier): ModelTier {
  switch (tier) {
    case 'free':     return 'standard';
    case 'standard': return 'premium';
    case 'premium':  return 'premium';
  }
}

/** Wrap a promise with a timeout. Rejects with a timeout error if exceeded. */
async function withTimeout<T>(promise: Promise<T>, ms: number, stepId: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`Step '${stepId}' timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}

function getStepTimeoutMs(step: WorkflowStep, context: WorkflowContext): number {
  const policy = context.executionPolicy ?? DEFAULT_WORKFLOW_EXECUTION_POLICY;
  const requestedTimeout = step.timeoutMs;
  const defaultTimeoutMs = Math.max(MIN_STEP_TIMEOUT_MS, policy.tool.defaultMs);
  const maxTimeoutMs = Math.max(defaultTimeoutMs, policy.tool.maxMs);

  if (!Number.isFinite(requestedTimeout) || requestedTimeout <= 0) {
    return defaultTimeoutMs;
  }

  return Math.max(MIN_STEP_TIMEOUT_MS, Math.min(requestedTimeout, maxTimeoutMs));
}

export class StepExecutor {
  constructor(private handler: StepHandlerFn, private log: Logger = STUB_LOGGER) {}

  /**
   * Execute a workflow step with retry/escalation logic.
   *
   * Attempt sequence:
   *   1. Original tier, original prompt
   *   2. Same tier, refined prompt (includes previous error)
   *   3+. Escalated tier
   *   After maxRetries+1 total attempts: return failed
   *
   * In dry-run mode (ROADIE_DRY_RUN=1): logs all operations but skips actual writes.
   */
  async executeStep(step: WorkflowStep, context: WorkflowContext): Promise<StepResult> {
    // use this.log
    const dryRunMode = isDryRun(context);
    if (dryRunMode) {
      this.log.info(`[DRY-RUN] Step '${step.id}' would be executed (dry-run mode enabled)`);
    }

    const maxAttempts = Math.max(1, (step.maxRetries ?? 0) + 1);
    const timeoutMs = getStepTimeoutMs(step, context);
    let currentTier = step.modelTier;
    let previousError: string | undefined;
    let lastFailureReason: StepFailureReason | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Check cancellation before each attempt
      if (context.cancellation.isCancelled) {
        this.log.info(`[${step.id}] Cancelled before attempt ${attempt}`);
        return {
          stepId:     step.id,
          status:     'cancelled',
          output:     '',
          tokenUsage: { input: 0, output: 0 },
          attempts:   attempt,
          modelUsed:  '',
          failureReason: 'cancelled',
        };
      }

      // Progressive tier escalation:
      //   Attempts 1-2: original tier
      //   Attempts 3-4: one tier up  (free→standard, standard→premium)
      //   Attempts 5+:  two tiers up (free→premium)
      const prevTier = currentTier;
      if (attempt >= 5) {
        currentTier = escalateTier(escalateTier(step.modelTier));
      } else if (attempt >= 3) {
        currentTier = escalateTier(step.modelTier);
      }

      if (currentTier !== prevTier) {
        this.log.warn(`[${step.id}] Attempt ${attempt}: escalating tier ${prevTier} → ${currentTier}`);
      } else {
        this.log.debug(`[${step.id}] Attempt ${attempt}/${maxAttempts} (tier: ${currentTier})`);
      }

      try {
        const result = await withTimeout(
          this.handler(step, context, {
            attempt,
            tier: currentTier,
            ...(previousError !== undefined ? { previousError } : {}),
          }),
          timeoutMs,
          step.id,
        );

        if (result.status === 'success') {
          if (attempt > 1) {
            this.log.info(`[${step.id}] Succeeded on attempt ${attempt}/${maxAttempts}`);
          }
          return { ...result, attempts: attempt };
        }

        // Step returned failure — prepare for retry
        previousError = result.error ?? result.output;
        lastFailureReason = result.failureReason ?? 'internal';
        if (previousError && previousError.length > 2_000) {
          previousError = previousError.slice(0, 2_000);
        }
        this.log.warn(
          `[${step.id}] Attempt ${attempt}/${maxAttempts} failed: ` +
          `${previousError?.slice(0, 120) ?? '(no detail)'}`,
        );
      } catch (err) {
        // Timeout or unexpected error
        previousError = err instanceof Error ? err.message : String(err);
        const isTimeout = previousError.includes('timed out');
        lastFailureReason = isTimeout ? 'timeout' : 'internal';
        if (isTimeout) {
          this.log.warn(`[${step.id}] Attempt ${attempt}/${maxAttempts} timed out (${timeoutMs}ms)`);
        } else {
          this.log.error(`[${step.id}] Attempt ${attempt}/${maxAttempts} threw`, err);
        }
      }
    }

    // All attempts exhausted
    const errMsg = `Step '${step.id}' failed after ${maxAttempts} attempts. Last error: ${previousError}`;
    this.log.error(`[${step.id}] All ${maxAttempts} attempts exhausted — step failed`);

    return {
      stepId:     step.id,
      status:     'failed',
      output:     '',
      tokenUsage: { input: 0, output: 0 },
      attempts:   maxAttempts,
      modelUsed:  '',
      error:      errMsg,
      failureReason: lastFailureReason ?? 'internal',
    };
  }
}

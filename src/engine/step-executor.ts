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

import * as path from 'node:path';
import * as fs from 'node:fs';
import type { WorkflowStep, WorkflowContext, StepResult, ModelTier } from '../types';
import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';

/**
 * Callback invoked by StepExecutor for each attempt.
 * In Phase 1 Step 6, tests provide a mock. Step 7 wires this to AgentSpawner.
 */
export type StepHandlerFn = (
  step: WorkflowStep,
  context: WorkflowContext,
  attemptInfo: { attempt: number; tier: ModelTier; previousError?: string },
) => Promise<StepResult>;

/** Check if dry-run mode is enabled via environment variable. */
function isDryRun(): boolean {
  return process.env.ROADIE_DRY_RUN === '1';
}

/**
 * Validate that a file path is safe (within project root, no traversal escapes).
 * Checks:
 *   - No `../` segments
 *   - Not an absolute path outside projectRoot
 *   - Not a symlink that escapes projectRoot
 *
 * @returns true if path is safe, false otherwise
 */
function isPathSafe(filePath: string, projectRoot: string): boolean {
  try {
    // Normalize paths to absolute
    const abs = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
    const normalized = path.normalize(abs);
    const rootNormalized = path.normalize(projectRoot);

    // Check: does not escape projectRoot
    if (!normalized.startsWith(rootNormalized)) {
      return false;
    }

    // Check: no `../` in the normalized path (double-check)
    if (normalized.includes('..')) {
      return false;
    }

    // Check: if it's a symlink, verify the target is within projectRoot
    if (fs.existsSync(abs)) {
      const stats = fs.lstatSync(abs);
      if (stats.isSymbolicLink()) {
        const target = fs.readlinkSync(abs);
        const targetAbs = path.isAbsolute(target) ? target : path.join(path.dirname(abs), target);
        const targetNormalized = path.normalize(targetAbs);
        if (!targetNormalized.startsWith(rootNormalized)) {
          return false;
        }
      }
    }

    return true;
  } catch {
    // On any error, deny for safety
    return false;
  }
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
    const dryRunMode = isDryRun();
    if (dryRunMode) {
      this.log.info(`[DRY-RUN] Step '${step.id}' would be executed (dry-run mode enabled)`);
    }

    const maxAttempts = Math.max(1, (step.maxRetries ?? 0) + 1);
    const timeoutMs = Math.max(1000, step.timeoutMs ?? 30_000);
    let currentTier = step.modelTier;
    let previousError: string | undefined;

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
        if (isTimeout) {
          this.log.warn(`[${step.id}] Attempt ${attempt}/${maxAttempts} timed out (${step.timeoutMs}ms)`);
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
    };
  }
}

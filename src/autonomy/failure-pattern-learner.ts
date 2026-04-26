/**
 * @module failure-pattern-learner
 * @description Queries LearningDatabase for workflow failures by type.
 *   Identifies patterns: steps that fail together, models that fail on step X.
 *   Prioritizes future workflows based on failure history.
 *
 * @outputs analyzeFailurePatterns(): { failureMap: Map<stepId, failCount>, modelSuccessRate: Map<tier, rate> }
 * @depends-on LearningDatabase, types
 * @depended-on-by autonomy-loop, model-selector
 */

import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';
import type { ModelTier } from '../types';

// ---- Types ----

export interface FailurePattern {
  stepId: string;
  stepName?: string;
  failCount: number;
  successCount: number;
  failureRate: number;
  commonErrors?: string[];
}

export interface ModelSuccessMetrics {
  tier: ModelTier;
  totalAttempts: number;
  successes: number;
  failures: number;
  successRate: number;
  averageTokens: number;
}

export interface FailurePatternAnalysis {
  failureMap: Map<string, FailurePattern>;
  modelSuccessRate: Map<ModelTier, ModelSuccessMetrics>;
  criticalSteps: FailurePattern[];
  unreliableModels: ModelSuccessMetrics[];
}

// ---- FailurePatternLearner ----

export class FailurePatternLearner {
  private logger: Logger = STUB_LOGGER;
  private failureHistory: Map<string, { stepId: string; failed: boolean; model: ModelTier; tokens: number }[]> = new Map();

  constructor(logger?: Logger) {
    if (logger) this.logger = logger;
  }

  /**
   * Record a workflow step execution result for learning.
   */
  recordExecution(
    workflowId: string,
    stepId: string,
    failed: boolean,
    model: ModelTier,
    tokens: number,
  ): void {
    if (!this.failureHistory.has(workflowId)) {
      this.failureHistory.set(workflowId, []);
    }

    const workflow = this.failureHistory.get(workflowId);
    if (!workflow) return;
    workflow.push({ stepId, failed, model, tokens });
  }

  /**
   * Analyze failure patterns from recorded executions.
   */
  analyzeFailurePatterns(): FailurePatternAnalysis {
    const failureMap = new Map<string, FailurePattern>();
    const modelMetrics = new Map<ModelTier, { total: number; successes: number; failures: number; tokens: number }>();

    // Initialize model metrics
    const tiers: ModelTier[] = ['free', 'standard', 'premium'];
    for (const tier of tiers) {
      modelMetrics.set(tier, { total: 0, successes: 0, failures: 0, tokens: 0 });
    }

    // Aggregate step-level failures
    for (const workflow of this.failureHistory.values()) {
      for (const execution of workflow) {
        // Step-level patterns
        if (!failureMap.has(execution.stepId)) {
          failureMap.set(execution.stepId, {
            stepId: execution.stepId,
            failCount: 0,
            successCount: 0,
            failureRate: 0,
          });
        }

        const pattern = failureMap.get(execution.stepId);
        if (!pattern) continue;
        if (execution.failed) {
          pattern.failCount++;
        } else {
          pattern.successCount++;
        }

        // Model-level metrics
        const metrics = modelMetrics.get(execution.model);
        if (!metrics) continue;
        metrics.total++;
        metrics.tokens += execution.tokens;
        if (execution.failed) {
          metrics.failures++;
        } else {
          metrics.successes++;
        }
      }
    }

    // Calculate success rates
    for (const pattern of failureMap.values()) {
      const total = pattern.failCount + pattern.successCount;
      pattern.failureRate = total > 0 ? pattern.failCount / total : 0;
    }

    // Convert model metrics to final format
    const modelSuccessRate = new Map<ModelTier, ModelSuccessMetrics>();
    for (const [tier, metrics] of modelMetrics) {
      const successRate = metrics.total > 0 ? metrics.successes / metrics.total : 1.0;
      const avgTokens = metrics.total > 0 ? metrics.tokens / metrics.total : 0;

      modelSuccessRate.set(tier, {
        tier,
        totalAttempts: metrics.total,
        successes: metrics.successes,
        failures: metrics.failures,
        successRate,
        averageTokens: avgTokens,
      });
    }

    // Find critical steps (failure rate > 30%)
    const criticalSteps = Array.from(failureMap.values())
      .filter((p) => p.failureRate > 0.3)
      .sort((a, b) => b.failureRate - a.failureRate);

    // Find unreliable models (success rate < 80%)
    const unreliableModels = Array.from(modelSuccessRate.values())
      .filter((m) => m.totalAttempts > 0 && m.successRate < 0.8)
      .sort((a, b) => a.successRate - b.successRate);

    this.logger.info(
      `[FailurePatternLearner] Analyzed ${failureMap.size} steps, found ${criticalSteps.length} critical, ${unreliableModels.length} unreliable models`,
    );

    return {
      failureMap,
      modelSuccessRate,
      criticalSteps,
      unreliableModels,
    };
  }

  /**
   * Get prioritized list of steps based on failure history (for scheduling).
   */
  getPrioritizedSteps(): string[] {
    const analysis = this.analyzeFailurePatterns();
    return analysis.criticalSteps.map((p) => p.stepId);
  }

  /**
   * Clear learning history (for reset/cache flush).
   */
  clearHistory(): void {
    this.failureHistory.clear();
    this.logger.info('[FailurePatternLearner] Cleared all learning history');
  }

  /**
   * Get failure rate for a specific step.
   */
  getStepFailureRate(stepId: string): number {
    let totalFailures = 0;
    let totalAttempts = 0;

    for (const workflow of this.failureHistory.values()) {
      for (const execution of workflow) {
        if (execution.stepId === stepId) {
          totalAttempts++;
          if (execution.failed) {
            totalFailures++;
          }
        }
      }
    }

    return totalAttempts > 0 ? totalFailures / totalAttempts : 0;
  }
}

export function createFailurePatternLearner(logger?: Logger): FailurePatternLearner {
  return new FailurePatternLearner(logger);
}

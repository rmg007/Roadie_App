/**
 * @module model-selector
 * @description Adaptive model selection based on historical success rates.
 *   Observes which model tier succeeds on which step type.
 *   Picks highest historical success rate; fallback to Opus (premium) if no history.
 *
 * @outputs selectModelForStep(stepId: string, stepType: string): ModelTier
 * @depends-on types, failure-pattern-learner
 * @depended-on-by autonomy-loop, workflow-engine
 */

import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';
import type { ModelTier } from '../types';
import type { FailurePatternLearner } from './failure-pattern-learner';

// ---- Types ----

export interface StepTypeMetrics {
  stepType: string;
  successByTier: Record<ModelTier, { successes: number; total: number; rate: number }>;
  recommendedTier: ModelTier;
  confidence: number; // 0-1, based on sample size
}

export interface ModelSelectionContext {
  stepId: string;
  stepType: string;
  workflowType?: string;
  complexity?: 'simple' | 'medium' | 'complex';
}

export interface ModelSelectionResult {
  selectedTier: ModelTier;
  confidence: number;
  reason: string;
  alternatives?: { tier: ModelTier; rate: number }[];
}

// ---- ModelSelector ----

export class ModelSelector {
  private logger: Logger = STUB_LOGGER;
  private failurePatternLearner: FailurePatternLearner;
  private successMatrix: Map<string, Record<ModelTier, { successes: number; total: number }>> = new Map();
  private stepTypeFrequency: Map<string, number> = new Map();

  constructor(failurePatternLearner: FailurePatternLearner, logger?: Logger) {
    this.failurePatternLearner = failurePatternLearner;
    if (logger) this.logger = logger;
  }

  /**
   * Record a step execution for model selection learning.
   */
  recordStepExecution(
    stepId: string,
    stepType: string,
    tier: ModelTier,
    succeeded: boolean,
  ): void {
    if (!this.successMatrix.has(stepType)) {
      this.successMatrix.set(stepType, {
        free: { successes: 0, total: 0 },
        standard: { successes: 0, total: 0 },
        premium: { successes: 0, total: 0 },
      });
    }

    const metrics = this.successMatrix.get(stepType);
    if (!metrics) return;
    metrics[tier].total++;
    if (succeeded) {
      metrics[tier].successes++;
    }

    this.stepTypeFrequency.set(stepType, (this.stepTypeFrequency.get(stepType) ?? 0) + 1);
  }

  /**
   * Select the best model tier for a step based on history.
   */
  selectModelForStep(context: ModelSelectionContext): ModelSelectionResult {
    const { stepType, complexity } = context;

    // Get historical metrics for this step type
    const metrics = this.successMatrix.get(stepType);

    if (!metrics || metrics.premium.total === 0) {
      // No history: fallback to premium (Opus)
      this.logger.info(`[ModelSelector] No history for ${stepType}, defaulting to premium`);
      return {
        selectedTier: 'premium',
        confidence: 0,
        reason: 'No historical data available',
      };
    }

    // Calculate success rates
    const tierRates: { tier: ModelTier; rate: number }[] = [];
    for (const tier of ['free', 'standard', 'premium'] as const) {
      const m = metrics[tier];
      const rate = m.total > 0 ? m.successes / m.total : 0;
      tierRates.push({ tier, rate });
    }

    // Sort by success rate
    tierRates.sort((a, b) => b.rate - a.rate);
    const recommended = tierRates[0];
    if (!recommended) {
      return {
        selectedTier: 'premium',
        confidence: 0,
        reason: 'No historical data available',
      };
    }

    // Adjust selection based on complexity
    let selectedTier = recommended.tier;
    if (complexity === 'complex') {
      // Upgrade for complex steps if there's uncertainty
      if (recommended.rate < 0.9) {
        selectedTier = 'premium';
      }
    } else if (complexity === 'simple' && recommended.rate > 0.95) {
      // Downgrade for simple steps if success is very high
      if (recommended.tier === 'standard') {
        selectedTier = 'free';
      }
    }

    // Calculate confidence (based on sample size)
    const sampleSize = metrics.premium.total;
    const confidence = Math.min(1.0, sampleSize / 100); // Full confidence at 100 samples

    const reason = `Selected based on ${sampleSize} historical runs (${(recommended.rate * 100).toFixed(1)}% success rate)`;

    return {
      selectedTier,
      confidence,
      reason,
      alternatives: tierRates.slice(1),
    };
  }

  /**
   * Get metrics for a specific step type.
   */
  getStepTypeMetrics(stepType: string): StepTypeMetrics | null {
    const metrics = this.successMatrix.get(stepType);
    if (!metrics) return null;

    const successByTier: Record<ModelTier, { successes: number; total: number; rate: number }> = {
      free: { ...metrics.free, rate: metrics.free.total > 0 ? metrics.free.successes / metrics.free.total : 0 },
      standard: { ...metrics.standard, rate: metrics.standard.total > 0 ? metrics.standard.successes / metrics.standard.total : 0 },
      premium: { ...metrics.premium, rate: metrics.premium.total > 0 ? metrics.premium.successes / metrics.premium.total : 0 },
    };

    // Find best tier
    const rates = [
      { tier: 'free' as const, rate: successByTier.free.rate },
      { tier: 'standard' as const, rate: successByTier.standard.rate },
      { tier: 'premium' as const, rate: successByTier.premium.rate },
    ];
    rates.sort((a, b) => b.rate - a.rate);
    const recommendedTier = rates[0]?.tier ?? 'premium';

    // Confidence based on sample size
    const totalSamples = metrics.free.total + metrics.standard.total + metrics.premium.total;
    const confidence = Math.min(1.0, totalSamples / 100);

    return {
      stepType,
      successByTier,
      recommendedTier,
      confidence,
    };
  }

  /**
   * Get all tracked step types.
   */
  getTrackedStepTypes(): string[] {
    return Array.from(this.successMatrix.keys());
  }

  /**
   * Clear learning history.
   */
  clearHistory(): void {
    this.successMatrix.clear();
    this.stepTypeFrequency.clear();
    this.logger.info('[ModelSelector] Cleared all learning history');
  }
}

export function createModelSelector(failurePatternLearner: FailurePatternLearner, logger?: Logger): ModelSelector {
  return new ModelSelector(failurePatternLearner, logger);
}

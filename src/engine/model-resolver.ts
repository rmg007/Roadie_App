/**
 * @module model-resolver
 * @description Maps model tiers to concrete model IDs via ModelProvider.
 *   Algorithm: walk TIER_PREFERENCE[tier] in order, return the first available
 *   model whose id contains the preference string. Falls back to lower tiers
 *   (premium -> standard -> free). Throws ModelUnavailableError if nothing matches.
 * @inputs ModelTier ('free' | 'standard' | 'premium'), ModelProvider
 * @outputs Model ID string
 * @depends-on model-priority.ts, errors.ts, providers.ts
 * @depended-on-by step-executor.ts, agent-spawner.ts
 */

import type { ModelTier } from '../types';
import type { ModelProvider, ModelInfo } from '../providers';
import { TIER_PREFERENCE } from './model-priority';
import { ModelUnavailableError } from './errors';

export class ModelResolver {
  private cachedModelsPromise: Promise<ModelInfo[]> | null = null;

  constructor(private modelProvider: ModelProvider) {}

  /**
   * Resolve a tier to a model ID string.
   *
   * Algorithm:
   *   1. Enumerate available models via `modelProvider.selectModels()`.
   *   2. For the requested tier, walk `TIER_PREFERENCE[tier]` in order.
   *   3. Return the first available model whose id contains the preference string.
   *   4. If none match, fall back to the next-lower tier (premium -> standard -> free).
   *   5. If even `free` has nothing, throw `ModelUnavailableError` with the complete
   *      list of models that were tried.
   *
   * Time budget: <= 50 ms (selectModels is cached after first call).
   */
  async resolve(tier: ModelTier): Promise<ModelInfo> {
    if (!this.cachedModelsPromise) {
      this.cachedModelsPromise = this.modelProvider.selectModels({}).catch((err) => {
        this.cachedModelsPromise = null;
        throw err;
      });
    }

    const availableModels = await this.cachedModelsPromise;
    const tried: string[] = [];

    // 1. Try all preferences for the current tier in declared order.
    for (const preference of TIER_PREFERENCE[tier]) {
      tried.push(preference);
      const match = availableModels.find((m) => matchesPreference(m.id, preference));
      if (match) return match;
    }

    // 2. Fall back to a lower tier if possible.
    if (tier === 'premium') return this.resolveWithCollectedAttempts('standard', tried);
    if (tier === 'standard') return this.resolveWithCollectedAttempts('free', tried);

    // 3. tier === 'free' and nothing matched: terminal failure.
    throw new ModelUnavailableError(tier, tried);
  }

  /** Internal helper — resolve and merge the `tried` list so the final error surfaces ALL attempted models. */
  private async resolveWithCollectedAttempts(
    tier: ModelTier,
    previouslyTried: readonly string[],
  ): Promise<ModelInfo> {
    try {
      return await this.resolve(tier);
    } catch (err) {
      if (err instanceof ModelUnavailableError) {
        // Rewrap with the full history
        throw new ModelUnavailableError(tier, [...previouslyTried, ...err.triedModels]);
      }
      throw err;
    }
  }
}

function matchesPreference(modelId: string, preference: string): boolean {
  if (modelId === preference) return true;
  if (modelId.endsWith(`-${preference}`)) return true;
  if (modelId.startsWith(`${preference}-`)) return true;
  if (modelId.includes(`-${preference}-`)) return true;
  return modelId.includes(preference);
}

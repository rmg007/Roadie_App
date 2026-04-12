/**
 * @module model-resolver
 * @description Maps model tiers to concrete vscode.LanguageModelChat instances.
 *   Algorithm: walk TIER_PREFERENCE[tier] in order, return the first available
 *   model whose id contains the preference string. Falls back to lower tiers
 *   (premium -> standard -> free). Throws ModelUnavailableError if nothing matches.
 * @inputs ModelTier ('free' | 'standard' | 'premium')
 * @outputs vscode.LanguageModelChat instance
 * @depends-on model-priority.ts, errors.ts, vscode LM API
 * @depended-on-by step-executor.ts, agent-spawner.ts
 */

import * as vscode from 'vscode';
import type { ModelTier } from '../types';
import { TIER_PREFERENCE } from './model-priority';
import { ModelUnavailableError } from './errors';

export class ModelResolver {
  /**
   * Resolve a tier to a concrete `vscode.LanguageModelChat` instance.
   *
   * Algorithm:
   *   1. Enumerate available models via `vscode.lm.selectChatModels()`.
   *   2. For the requested tier, walk `TIER_PREFERENCE[tier]` in order.
   *   3. Return the first available model whose id contains the preference string.
   *   4. If none match, fall back to the next-lower tier (premium -> standard -> free).
   *   5. If even `free` has nothing, throw `ModelUnavailableError` with the complete
   *      list of models that were tried.
   *
   * Time budget: <= 50 ms (selectChatModels is cached by VS Code after first call).
   */
  async resolve(tier: ModelTier): Promise<vscode.LanguageModelChat> {
    const availableModels = await vscode.lm.selectChatModels();
    const tried: string[] = [];

    // 1. Try all preferences for the current tier in declared order.
    for (const preference of TIER_PREFERENCE[tier]) {
      tried.push(preference);
      const match = availableModels.find((m) => m.id.includes(preference));
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
  ): Promise<vscode.LanguageModelChat> {
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

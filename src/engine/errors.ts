/**
 * @module errors
 * @description Engine-specific error classes.
 *   ModelUnavailableError is thrown when no model is available for
 *   the requested tier AND all fallback tiers have been exhausted.
 * @depends-on types.ts (ModelTier)
 * @depended-on-by model-resolver.ts, workflow-engine.ts
 */

import type { ModelTier } from '../types';

/** Thrown when no model is available for the requested tier AND fallback tiers have all been exhausted. */
export class ModelUnavailableError extends Error {
  readonly code = 'MODEL_UNAVAILABLE';
  readonly category = 'external' as const;
  readonly userFacing = true;

  constructor(
    public readonly requestedTier: ModelTier,
    public readonly triedModels: readonly string[],
  ) {
    super(
      `No language model available for tier '${requestedTier}'. ` +
      `Tried: ${triedModels.join(', ') || '(none)'}. ` +
      `Check your Copilot subscription or configure a direct API key.`,
    );
    this.name = 'ModelUnavailableError';
  }
}

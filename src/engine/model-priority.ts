/**
 * @module model-priority
 * @description Exhaustive priority map and tier preference lists for model selection.
 *   Every model named in any tier MUST appear in MODEL_PRIORITY.
 *   TIER_PREFERENCE declares the fallback order within each tier.
 * @inputs None (constants only)
 * @outputs MODEL_PRIORITY, TIER_PREFERENCE
 * @depends-on types.ts (ModelTier)
 * @depended-on-by model-resolver.ts
 */

import type { ModelTier } from '../types';

/** Exhaustive priority map — every model named in any tier MUST appear here. */
export const MODEL_PRIORITY: Readonly<Record<string, number>> = {
  // Tier 2 (Premium) — tried first if tier === 'premium'
  'claude-opus-4.6':   0,
  // Tier 1 (Standard)
  'claude-sonnet-4.6': 10,
  'gpt-5.2':           11,
  'gemini-2.5-pro':    12,
  // Tier 0 (Free)
  'gpt-4.1':           20,
  'gpt-5-mini':        21,
} as const;

/** Tier -> ordered preference list. Order in the array IS the fallback order within the tier. */
export const TIER_PREFERENCE: Readonly<Record<ModelTier, readonly string[]>> = {
  free:     ['gpt-4.1', 'gpt-5-mini'],
  standard: ['claude-sonnet-4.6', 'gpt-5.2', 'gemini-2.5-pro'],
  premium:  ['claude-opus-4.6'],
} as const;

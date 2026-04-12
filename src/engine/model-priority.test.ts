import { describe, it, expect } from 'vitest';
import { MODEL_PRIORITY, TIER_PREFERENCE } from './model-priority';

describe('MODEL_PRIORITY exhaustiveness', () => {
  it('every model named in TIER_PREFERENCE has a priority entry', () => {
    for (const tier of Object.keys(TIER_PREFERENCE) as (keyof typeof TIER_PREFERENCE)[]) {
      for (const name of TIER_PREFERENCE[tier]) {
        expect(MODEL_PRIORITY[name]).toBeDefined();
      }
    }
  });

  it('priorities are unique', () => {
    const values = Object.values(MODEL_PRIORITY);
    expect(new Set(values).size).toBe(values.length);
  });

  it('contains exactly 6 models', () => {
    expect(Object.keys(MODEL_PRIORITY)).toHaveLength(6);
  });

  it('free tier has at least one preference', () => {
    expect(TIER_PREFERENCE.free.length).toBeGreaterThanOrEqual(1);
  });

  it('standard tier has at least one preference', () => {
    expect(TIER_PREFERENCE.standard.length).toBeGreaterThanOrEqual(1);
  });

  it('premium tier has at least one preference', () => {
    expect(TIER_PREFERENCE.premium.length).toBeGreaterThanOrEqual(1);
  });
});

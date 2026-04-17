/**
 * @test memory.test.ts (F2)
 * @description BLOCKING memory ceiling budget.
 *   Runs 10,000 classify() calls and asserts RSS delta < 50 MB.
 */

import { describe, it, expect } from 'vitest';

const MEMORY_BUDGET_MB = 50;
const OPS = 10_000;

describe('F2 — Memory ceiling (BLOCKING)', () => {
  it(`RSS delta < ${MEMORY_BUDGET_MB}MB after ${OPS} classify ops`, async () => {
    const { IntentClassifier } = await import('../classifier/intent-classifier');
    const classifier = new IntentClassifier();

    const before = process.memoryUsage().rss;
    const prompts = ['fix bug', 'refactor code', 'add feature', 'review PR', 'document function'];
    for (let i = 0; i < OPS; i++) {
      classifier.classify(prompts[i % prompts.length]);
    }

    // Force GC if available
    if ((global as Record<string, unknown>).gc) {
      (global as unknown as { gc: () => void }).gc();
    }

    const after = process.memoryUsage().rss;
    const deltaMB = (after - before) / 1_048_576;
    console.log(`[perf] memory delta after ${OPS} ops: ${deltaMB.toFixed(1)}MB (budget: ${MEMORY_BUDGET_MB}MB)`);
    expect(deltaMB).toBeLessThan(MEMORY_BUDGET_MB); // BLOCKING
  });
});

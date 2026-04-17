/**
 * @test activation.test.ts (F1)
 * @description BLOCKING activation latency budget.
 *   Measures median-of-5 import+construction time for IntentClassifier,
 *   the heaviest synchronous initialisation in the extension entry path.
 *   Budget: < 250 ms.
 */

import { describe, it, expect } from 'vitest';

const BUDGET_MS = 250;
const RUNS = 5;

describe('F1 — Activation latency (BLOCKING)', () => {
  it(`median activation time is < ${BUDGET_MS}ms`, async () => {
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      // Dynamic import of the classifier (the heaviest synchronous init)
      const { IntentClassifier } = await import('../classifier/intent-classifier');
      new IntentClassifier();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(RUNS / 2)];
    console.log(`[perf] activation median: ${median.toFixed(1)}ms (budget: ${BUDGET_MS}ms)`);
    expect(median).toBeLessThan(BUDGET_MS); // BLOCKING
  });
});

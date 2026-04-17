/**
 * Phase 4 — Upgrade and degraded mode (unit-level)
 *
 * Tests that verify Roadie's SQLite error-handling path without requiring
 * a real VS Code instance. These exercise the LearningDatabase fallback
 * behaviour when the database cannot be opened.
 *
 * The real E2E chaos tests live in e2e/chaos/degraded-mode.suite.js.
 */

import { describe, it, expect } from 'vitest';
import { LearningDatabase } from '../learning/learning-database';

// ---------------------------------------------------------------------------
// Degraded mode: initialize() failure → extension uses null
// ---------------------------------------------------------------------------

describe('LearningDatabase — degraded-mode safety', () => {
  it('initialize() throws when given a non-database value', () => {
    const db = new LearningDatabase();
    // The extension catches this and sets learningDb = null
    expect(() => db.initialize({} as never)).toThrow();
  });

  it('methods throw when called without initialize()', () => {
    const db = new LearningDatabase();
    // These throw — the extension guards with learningDb?.method() or null checks
    expect(() => db.getWorkflowStats()).toThrow('LearningDatabase not initialized');
    expect(() => db.getDatabaseSize()).toThrow('LearningDatabase not initialized');
    expect(() => db.getWorkflowHistory(10)).toThrow('LearningDatabase not initialized');
  });

  it('recordWorkflowOutcome() is a no-op when called without initialize()', () => {
    const db = new LearningDatabase();
    // Does NOT throw — guard is handled via config flag, not db presence
    expect(() =>
      db.recordWorkflowOutcome({
        workflowType: 'bug_fix',
        prompt: 'fix the crash',
        status: 'COMPLETED',
        stepsCompleted: 3,
        stepsTotal: 3,
      }),
    ).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Healthy path: in-memory SQLite
  // ---------------------------------------------------------------------------

  it('initializes and records workflow outcomes in-memory', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const sqliteDb = new DatabaseSync(':memory:');
    const db = new LearningDatabase();
    db.initialize(sqliteDb, { workflowHistory: true });

    db.recordWorkflowOutcome({
      workflowType: 'feature',
      prompt: 'add login page',
      status: 'completed',
      stepsCompleted: 7,
      stepsTotal: 7,
      durationMs: 4200,
    });

    const stats = db.getWorkflowStats();
    expect(stats.totalWorkflows).toBe(1);
    expect(stats.successCount).toBe(1);
    expect(stats.successRate).toBe(1);
  });

  it('getWorkflowStats() on 1000 records returns in under 500ms', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const sqliteDb = new DatabaseSync(':memory:');
    const db = new LearningDatabase();
    db.initialize(sqliteDb, { workflowHistory: true });

    for (let i = 0; i < 1000; i++) {
      db.recordWorkflowOutcome({
        workflowType: i % 2 === 0 ? 'bug_fix' : 'feature',
        prompt: `prompt ${i}`,
        status: i % 5 === 0 ? 'failed' : 'completed',
        stepsCompleted: i % 5 === 0 ? 2 : 7,
        stepsTotal: 7,
        durationMs: 1000 + i,
      });
    }

    const start = performance.now();
    const stats = db.getWorkflowStats();
    const elapsed = performance.now() - start;

    expect(stats.totalWorkflows).toBe(1000);
    expect(elapsed).toBeLessThan(500);
    console.log(`[perf] getWorkflowStats(1000 records): ${elapsed.toFixed(1)}ms`);
  });
});


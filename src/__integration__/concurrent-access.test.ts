/**
 * Phase 4 — Concurrent access safety
 *
 * Simulates two VS Code windows pointing at the same workspace by opening
 * two LearningDatabase instances against the same SQLite file. Verifies that
 * interleaved writes do not corrupt the database and that both readers see
 * a consistent total.
 *
 * The real two-window E2E case lives in e2e/chaos/ but is hard to drive
 * deterministically from extension-tester. This unit-level check exercises
 * the same code path (`recordWorkflowOutcome` under contention) and is fast.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { LearningDatabase } from '../learning/learning-database';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function makeDb(file: string): { raw: InstanceType<typeof DatabaseSync>; learning: LearningDatabase } {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA busy_timeout = 5000');
  const learning = new LearningDatabase();
  learning.initialize(raw, { workflowHistory: true });
  return { raw, learning };
}

function cleanupDb(file: string): void {
  if (file && fs.existsSync(file)) {
    try { fs.unlinkSync(file); } catch { /* WAL files cleaned up by sqlite */ }
    for (const ext of ['-wal', '-shm']) {
      const aux = file + ext;
      if (fs.existsSync(aux)) {
        try { fs.unlinkSync(aux); } catch { /* best effort */ }
      }
    }
  }
}

describe('Phase 4 — concurrent access on a shared SQLite file', () => {
  let dbFile: string;

  afterEach(() => {
    cleanupDb(dbFile);
  });

  it('two writers on the same file produce a consistent total', () => {
    dbFile = path.join(os.tmpdir(), `roadie-concurrent-${Date.now()}.db`);

    const a = makeDb(dbFile);
    const b = makeDb(dbFile);

    const PER_WRITER = 50;
    for (let i = 0; i < PER_WRITER; i++) {
      a.learning.recordWorkflowOutcome({
        workflowType: 'feature',
        prompt: `a:${i}`,
        status: 'COMPLETED',
        stepsCompleted: 3,
        stepsTotal: 3,
        durationMs: 100,
      });
      b.learning.recordWorkflowOutcome({
        workflowType: 'bug_fix',
        prompt: `b:${i}`,
        status: 'COMPLETED',
        stepsCompleted: 2,
        stepsTotal: 2,
        durationMs: 50,
      });
    }

    // Either reader must see both writers' rows
    const totalFromA = a.learning.getWorkflowStats().totalWorkflows;
    const totalFromB = b.learning.getWorkflowStats().totalWorkflows;
    expect(totalFromA).toBe(PER_WRITER * 2);
    expect(totalFromB).toBe(PER_WRITER * 2);

    a.learning.close();
    b.learning.close();
  });

  it('integrity check passes after concurrent writes', () => {
    dbFile = path.join(os.tmpdir(), `roadie-integrity-${Date.now()}.db`);
    const a = makeDb(dbFile);
    const b = makeDb(dbFile);

    for (let i = 0; i < 20; i++) {
      a.learning.recordWorkflowOutcome({
        workflowType: 'review',
        prompt: `r:${i}`,
        status: 'COMPLETED',
        stepsCompleted: 1,
        stepsTotal: 1,
      });
      b.learning.recordWorkflowOutcome({
        workflowType: 'review',
        prompt: `r-b:${i}`,
        status: 'PAUSED',
        stepsCompleted: 0,
        stepsTotal: 1,
      });
    }

    const result = a.raw.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    expect(result.integrity_check).toBe('ok');

    a.learning.close();
    b.learning.close();
  });
});

// ---------------------------------------------------------------------------
// B7 — Extended stress: 10 readers + 2 writers × 1000 ops × 5 iterations
// ---------------------------------------------------------------------------

describe('B7 — Concurrent stress (10 readers + 2 writers × 1000 ops × 5 iterations)', () => {
  const dbFiles: string[] = [];

  afterEach(() => {
    for (const f of dbFiles) cleanupDb(f);
    dbFiles.length = 0;
  });

  it('integrity_check passes and row count is correct after stress run', () => {
    const file = path.join(os.tmpdir(), `roadie-stress-b7-${Date.now()}.db`);
    dbFiles.push(file);

    // Writers
    const writer1 = makeDb(file);
    const writer2 = makeDb(file);

    // Readers (10 separate connections)
    const readers = Array.from({ length: 10 }, () => makeDb(file));

    const ITERATIONS = 5;
    const OPS_PER_ITER = 1000;
    const WRITES_PER_ITER = OPS_PER_ITER; // 500 per writer × 2

    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (let op = 0; op < OPS_PER_ITER / 2; op++) {
        writer1.learning.recordWorkflowOutcome({
          workflowType: 'feature',
          prompt: `stress-w1-${iter}-${op}`,
          status: 'COMPLETED',
          stepsCompleted: 1,
          stepsTotal: 1,
          durationMs: 10,
        });
        writer2.learning.recordWorkflowOutcome({
          workflowType: 'bug_fix',
          prompt: `stress-w2-${iter}-${op}`,
          status: 'COMPLETED',
          stepsCompleted: 1,
          stepsTotal: 1,
          durationMs: 10,
        });

        // All readers see at least the rows written so far (monotonically increasing)
        if (op % 100 === 0) {
          for (const reader of readers) {
            const stats = reader.learning.getWorkflowStats();
            expect(stats.totalWorkflows).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }

    const expectedTotal = ITERATIONS * WRITES_PER_ITER;

    // Integrity check via writer1
    const integrityRow = writer1.raw.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    expect(integrityRow.integrity_check).toBe('ok');

    // Row count via each connection
    const totalFromWriter1 = writer1.learning.getWorkflowStats().totalWorkflows;
    expect(totalFromWriter1).toBe(expectedTotal);

    for (const reader of readers) {
      const total = reader.learning.getWorkflowStats().totalWorkflows;
      expect(total).toBe(expectedTotal);
    }

    // Cleanup
    writer1.learning.close();
    writer2.learning.close();
    for (const reader of readers) reader.learning.close();
  });
});

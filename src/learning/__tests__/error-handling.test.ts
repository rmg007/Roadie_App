/**
 * @test error-handling.test.ts (B8 + B9)
 * @description
 *   B8: Verifies that ENOSPC/EACCES errors from SQLite exec are caught and
 *       re-thrown as RoadieError(DB_WRITE_FAILED).
 *   B9: Verifies that when workspace.isTrusted === false, no INSERT/UPDATE/DELETE
 *       statements are executed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LearningDatabase } from '../learning-database';
import { RoadieError } from '../../shell/errors';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function createMemoryDb(): InstanceType<typeof DatabaseSync> {
  return new DatabaseSync(':memory:');
}

// ---- B8: ENOSPC / EACCES ----

describe('B8 — ENOSPC/EACCES → RoadieError(DB_WRITE_FAILED)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws RoadieError(DB_WRITE_FAILED) when ENOSPC is raised during recordSnapshot', () => {
    const db = createMemoryDb();
    const learning = new LearningDatabase();
    learning.initialize(db, { workflowHistory: true });

    // Patch the prepare().run to throw ENOSPC
    const enospc = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    const origPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const stmt = origPrepare(sql);
      if (sql.includes('INSERT INTO file_snapshots')) {
        vi.spyOn(stmt, 'run').mockImplementation(() => { throw enospc; });
      }
      return stmt;
    });

    expect(() =>
      learning.recordSnapshot('/src/test.ts', 'content', 'roadie'),
    ).toThrow(RoadieError);

    let caughtCode = '';
    try {
      learning.recordSnapshot('/src/test.ts', 'content2', 'roadie');
    } catch (err) {
      if (err instanceof RoadieError) caughtCode = err.code;
    }
    expect(caughtCode).toBe('DB_WRITE_FAILED');

    learning.close();
    db.close();
  });

  it('throws RoadieError(DB_WRITE_FAILED) when EACCES is raised during recordWorkflowOutcome', () => {
    const db = createMemoryDb();
    const learning = new LearningDatabase();
    learning.initialize(db, { workflowHistory: true });

    const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const origPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const stmt = origPrepare(sql);
      if (sql.includes('INSERT INTO workflow_history')) {
        vi.spyOn(stmt, 'run').mockImplementation(() => { throw eacces; });
      }
      return stmt;
    });

    expect(() =>
      learning.recordWorkflowOutcome({
        workflowType: 'bug_fix',
        prompt: 'test',
        status: 'COMPLETED',
        stepsCompleted: 1,
        stepsTotal: 1,
      }),
    ).toThrow(RoadieError);

    let caughtCode = '';
    let caughtMessage = '';
    try {
      learning.recordWorkflowOutcome({
        workflowType: 'bug_fix',
        prompt: 'test2',
        status: 'COMPLETED',
        stepsCompleted: 1,
        stepsTotal: 1,
      });
    } catch (err) {
      if (err instanceof RoadieError) {
        caughtCode = err.code;
        caughtMessage = err.message;
      }
    }
    expect(caughtCode).toBe('DB_WRITE_FAILED');
    expect(caughtMessage).toContain('EACCES');

    learning.close();
    db.close();
  });

  it('non-ENOSPC/EACCES errors are re-thrown as-is (not wrapped)', () => {
    const db = createMemoryDb();
    const learning = new LearningDatabase();
    learning.initialize(db, { workflowHistory: true });

    const randomError = new Error('some other db error');
    const origPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const stmt = origPrepare(sql);
      if (sql.includes('INSERT INTO file_snapshots')) {
        vi.spyOn(stmt, 'run').mockImplementation(() => { throw randomError; });
      }
      return stmt;
    });

    let caught: unknown;
    try {
      learning.recordSnapshot('/src/test.ts', 'content', 'roadie');
    } catch (err) {
      caught = err;
    }

    // Should be the original error, NOT wrapped in RoadieError
    expect(caught).toBe(randomError);
    expect(caught instanceof RoadieError).toBe(false);

    learning.close();
    db.close();
  });
});

// ---- B9: Workspace trust gate ----

describe('B9 — Workspace trust gate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unmock('vscode');
  });

  it('recordSnapshot is skipped when workspace is not trusted', () => {
    const db = createMemoryDb();
    const learning = new LearningDatabase();
    learning.initialize(db, { workflowHistory: true });

    // Override the private isTrusted getter using Object.defineProperty
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.defineProperty(learning as any, 'isTrusted', {
      get: () => false,
      configurable: true,
    });

    const prepareSpy = vi.spyOn(db, 'prepare');

    learning.recordSnapshot('/src/test.ts', 'content', 'roadie');

    // prepare should NOT have been called for an INSERT INTO file_snapshots
    const insertCalls = prepareSpy.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO file_snapshots'),
    );
    expect(insertCalls).toHaveLength(0);

    learning.close();
    db.close();
  });

  it('recordWorkflowOutcome is skipped when workspace is not trusted', () => {
    const db = createMemoryDb();
    const learning = new LearningDatabase();
    learning.initialize(db, { workflowHistory: true });

    // Override the private isTrusted getter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.defineProperty(learning as any, 'isTrusted', {
      get: () => false,
      configurable: true,
    });

    const prepareSpy = vi.spyOn(db, 'prepare');

    learning.recordWorkflowOutcome({
      workflowType: 'bug_fix',
      prompt: 'test',
      status: 'COMPLETED',
      stepsCompleted: 1,
      stepsTotal: 1,
    });

    // No INSERT INTO workflow_history should have been prepared
    const insertCalls = prepareSpy.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO workflow_history'),
    );
    expect(insertCalls).toHaveLength(0);

    learning.close();
    db.close();
  });

  it('writes proceed normally when workspace is trusted', () => {
    const db = createMemoryDb();
    const learning = new LearningDatabase();
    learning.initialize(db, { workflowHistory: true });

    // Default: isTrusted = true (no vscode mock, falls back to true)
    expect(() =>
      learning.recordSnapshot('/src/test.ts', 'content', 'roadie'),
    ).not.toThrow();

    const snapshots = learning.getSnapshots('/src/test.ts');
    expect(snapshots).toHaveLength(1);

    learning.close();
    db.close();
  });
});

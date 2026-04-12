import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { LearningDatabase } from './learning-database';
import type { WorkflowOutcomeInput } from './learning-database';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('LearningDatabase', () => {
  let rawDb: Database.Database;
  let learning: LearningDatabase;

  beforeEach(() => {
    rawDb = createTestDb();
    learning = new LearningDatabase();
    learning.initialize(rawDb, { workflowHistory: true });
  });

  afterEach(() => {
    learning.close();
    rawDb.close();
  });

  // ================================================================
  // File Snapshots
  // ================================================================

  describe('file snapshots', () => {
    it('records and retrieves a snapshot', () => {
      learning.recordSnapshot('/src/index.ts', 'console.log("hi")', 'human');
      const snapshots = learning.getSnapshots('/src/index.ts');
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].filePath).toBe('/src/index.ts');
      expect(snapshots[0].content).toBe('console.log("hi")');
      expect(snapshots[0].source).toBe('human');
      expect(snapshots[0].contentHash).toHaveLength(64); // SHA-256 hex
    });

    it('returns snapshots ordered by most recent first', () => {
      learning.recordSnapshot('/a.ts', 'v1', 'human');
      learning.recordSnapshot('/a.ts', 'v2', 'roadie');
      learning.recordSnapshot('/a.ts', 'v3', 'human');
      const snapshots = learning.getSnapshots('/a.ts');
      expect(snapshots).toHaveLength(3);
      // Most recent has id 3
      expect(snapshots[0].content).toBe('v3');
      expect(snapshots[2].content).toBe('v1');
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        learning.recordSnapshot('/a.ts', `v${i}`, 'human');
      }
      const snapshots = learning.getSnapshots('/a.ts', 3);
      expect(snapshots).toHaveLength(3);
    });

    it('getLatestSnapshot returns the most recent', () => {
      learning.recordSnapshot('/a.ts', 'old', 'human');
      learning.recordSnapshot('/a.ts', 'new', 'roadie');
      const latest = learning.getLatestSnapshot('/a.ts');
      expect(latest).not.toBeNull();
      expect(latest!.content).toBe('new');
      expect(latest!.source).toBe('roadie');
    });

    it('getLatestSnapshot returns null for unknown file', () => {
      expect(learning.getLatestSnapshot('/no-such-file.ts')).toBeNull();
    });

    it('only returns snapshots for the requested file', () => {
      learning.recordSnapshot('/a.ts', 'a-content', 'human');
      learning.recordSnapshot('/b.ts', 'b-content', 'roadie');
      expect(learning.getSnapshots('/a.ts')).toHaveLength(1);
      expect(learning.getSnapshots('/b.ts')).toHaveLength(1);
      expect(learning.getSnapshots('/c.ts')).toHaveLength(0);
    });

    it('computes consistent SHA-256 hashes', () => {
      learning.recordSnapshot('/a.ts', 'same content', 'human');
      learning.recordSnapshot('/b.ts', 'same content', 'roadie');
      const a = learning.getLatestSnapshot('/a.ts')!;
      const b = learning.getLatestSnapshot('/b.ts')!;
      expect(a.contentHash).toBe(b.contentHash);
    });
  });

  // ================================================================
  // Workflow History
  // ================================================================

  describe('workflow history', () => {
    const sampleEntry: WorkflowOutcomeInput = {
      workflowType: 'bug_fix',
      prompt: 'fix the login bug',
      status: 'completed',
      stepsCompleted: 3,
      stepsTotal: 3,
      durationMs: 4500,
      modelTiersUsed: 'standard,premium',
    };

    it('records and retrieves workflow history', () => {
      learning.recordWorkflowOutcome(sampleEntry);
      const history = learning.getWorkflowHistory();
      expect(history).toHaveLength(1);
      expect(history[0].workflowType).toBe('bug_fix');
      expect(history[0].prompt).toBe('fix the login bug');
      expect(history[0].durationMs).toBe(4500);
    });

    it('skips recording when workflowHistory config is false', () => {
      const db2 = createTestDb();
      const learning2 = new LearningDatabase();
      learning2.initialize(db2, { workflowHistory: false });

      learning2.recordWorkflowOutcome(sampleEntry);
      expect(learning2.getWorkflowHistory()).toHaveLength(0);

      learning2.close();
      db2.close();
    });

    it('skips recording when workflowHistory config is undefined', () => {
      const db2 = createTestDb();
      const learning2 = new LearningDatabase();
      learning2.initialize(db2);

      learning2.recordWorkflowOutcome(sampleEntry);
      expect(learning2.getWorkflowHistory()).toHaveLength(0);

      learning2.close();
      db2.close();
    });

    it('returns history ordered by most recent first', () => {
      learning.recordWorkflowOutcome({ ...sampleEntry, prompt: 'first' });
      learning.recordWorkflowOutcome({ ...sampleEntry, prompt: 'second' });
      const history = learning.getWorkflowHistory();
      expect(history[0].prompt).toBe('second');
      expect(history[1].prompt).toBe('first');
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        learning.recordWorkflowOutcome({ ...sampleEntry, prompt: `p${i}` });
      }
      expect(learning.getWorkflowHistory(3)).toHaveLength(3);
    });

    it('handles optional fields as null', () => {
      learning.recordWorkflowOutcome({
        workflowType: 'feature',
        prompt: 'add button',
        status: 'failed',
        stepsCompleted: 1,
        stepsTotal: 5,
      });
      const entry = learning.getWorkflowHistory()[0];
      expect(entry.durationMs).toBeNull();
      expect(entry.modelTiersUsed).toBeNull();
      expect(entry.errorSummary).toBeNull();
    });
  });

  // ================================================================
  // Workflow Stats
  // ================================================================

  describe('workflow stats', () => {
    it('returns zero stats for empty history', () => {
      const stats = learning.getWorkflowStats();
      expect(stats.totalWorkflows).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.averageDurationMs).toBe(0);
    });

    it('computes correct stats', () => {
      learning.recordWorkflowOutcome({ workflowType: 'bug_fix', prompt: 'a', status: 'completed', stepsCompleted: 3, stepsTotal: 3, durationMs: 1000 });
      learning.recordWorkflowOutcome({ workflowType: 'bug_fix', prompt: 'b', status: 'completed', stepsCompleted: 2, stepsTotal: 2, durationMs: 2000 });
      learning.recordWorkflowOutcome({ workflowType: 'feature', prompt: 'c', status: 'failed', stepsCompleted: 1, stepsTotal: 4, durationMs: 500 });

      const stats = learning.getWorkflowStats();
      expect(stats.totalWorkflows).toBe(3);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.successRate).toBeCloseTo(2 / 3);
      expect(stats.averageDurationMs).toBe(Math.round((1000 + 2000 + 500) / 3));
      expect(stats.byType['bug_fix']).toEqual({ count: 2, successCount: 2 });
      expect(stats.byType['feature']).toEqual({ count: 1, successCount: 0 });
    });

    it('treats "success" status as success', () => {
      learning.recordWorkflowOutcome({ workflowType: 'refactor', prompt: 'r', status: 'success', stepsCompleted: 1, stepsTotal: 1 });
      const stats = learning.getWorkflowStats();
      expect(stats.successCount).toBe(1);
    });
  });

  // ================================================================
  // Section Hashes
  // ================================================================

  describe('section hashes', () => {
    it('returns null for unknown section', () => {
      expect(learning.getSectionHash('/a.md', 'intro')).toBeNull();
    });

    it('sets and gets a section hash', () => {
      learning.setSectionHash('/a.md', 'intro', 'abc123');
      expect(learning.getSectionHash('/a.md', 'intro')).toBe('abc123');
    });

    it('updates an existing section hash', () => {
      learning.setSectionHash('/a.md', 'intro', 'old');
      learning.setSectionHash('/a.md', 'intro', 'new');
      expect(learning.getSectionHash('/a.md', 'intro')).toBe('new');
    });

    it('stores hashes independently per file and section', () => {
      learning.setSectionHash('/a.md', 'intro', 'h1');
      learning.setSectionHash('/a.md', 'body', 'h2');
      learning.setSectionHash('/b.md', 'intro', 'h3');
      expect(learning.getSectionHash('/a.md', 'intro')).toBe('h1');
      expect(learning.getSectionHash('/a.md', 'body')).toBe('h2');
      expect(learning.getSectionHash('/b.md', 'intro')).toBe('h3');
    });
  });

  // ================================================================
  // Pruning
  // ================================================================

  describe('pruning', () => {
    it('keeps last 50 snapshots per file', () => {
      for (let i = 0; i < 60; i++) {
        learning.recordSnapshot('/big.ts', `content-${i}`, 'human');
      }
      const result = learning.prune();
      expect(result.snapshotsRemoved).toBe(10);
      expect(learning.getSnapshots('/big.ts')).toHaveLength(50);
    });

    it('prunes each file independently', () => {
      for (let i = 0; i < 55; i++) {
        learning.recordSnapshot('/a.ts', `a-${i}`, 'human');
        learning.recordSnapshot('/b.ts', `b-${i}`, 'roadie');
      }
      const result = learning.prune();
      expect(result.snapshotsRemoved).toBe(10); // 5 from /a.ts + 5 from /b.ts
      expect(learning.getSnapshots('/a.ts')).toHaveLength(50);
      expect(learning.getSnapshots('/b.ts')).toHaveLength(50);
    });

    it('keeps last 100 workflow history entries', () => {
      for (let i = 0; i < 120; i++) {
        learning.recordWorkflowOutcome({
          workflowType: 'test',
          prompt: `p${i}`,
          status: 'completed',
          stepsCompleted: 1,
          stepsTotal: 1,
        });
      }
      const result = learning.prune();
      expect(result.historyEntriesRemoved).toBe(20);
      expect(learning.getWorkflowHistory(200)).toHaveLength(100);
    });

    it('returns zeros when nothing to prune', () => {
      learning.recordSnapshot('/a.ts', 'content', 'human');
      const result = learning.prune();
      expect(result.snapshotsRemoved).toBe(0);
      expect(result.historyEntriesRemoved).toBe(0);
    });
  });

  // ================================================================
  // Database Size & Edge Cases
  // ================================================================

  describe('database size and edge cases', () => {
    it('returns 0 for empty database', () => {
      expect(learning.getDatabaseSize()).toBe(0);
    });

    it('counts all rows across tables', () => {
      learning.recordSnapshot('/a.ts', 'content', 'human');
      learning.recordWorkflowOutcome({
        workflowType: 'test', prompt: 'p', status: 'completed',
        stepsCompleted: 1, stepsTotal: 1,
      });
      learning.setSectionHash('/a.md', 'intro', 'h');
      expect(learning.getDatabaseSize()).toBe(3);
    });

    it('throws if not initialized', () => {
      const uninit = new LearningDatabase();
      expect(() => uninit.recordSnapshot('/a.ts', 'x', 'human')).toThrow('not initialized');
    });

    it('prune runs automatically on initialize', () => {
      // Insert 60 snapshots directly, then re-initialize to trigger prune
      for (let i = 0; i < 60; i++) {
        learning.recordSnapshot('/a.ts', `c${i}`, 'human');
      }
      expect(learning.getSnapshots('/a.ts')).toHaveLength(50); // default limit
      // But there are actually 60 rows. Re-initialize triggers prune.
      const learning2 = new LearningDatabase();
      learning2.initialize(rawDb, { workflowHistory: true });
      expect(learning2.getSnapshots('/a.ts', 100)).toHaveLength(50);
      learning2.close();
    });

    it('works with the same db instance as RoadieDatabase tables', () => {
      // Simulate Phase 1 tables existing in the same database
      rawDb.exec('CREATE TABLE IF NOT EXISTS tech_stack (id INTEGER PRIMARY KEY, name TEXT)');
      rawDb.prepare('INSERT INTO tech_stack (name) VALUES (?)').run('TypeScript');

      // Learning tables should still work
      learning.recordSnapshot('/a.ts', 'content', 'human');
      expect(learning.getSnapshots('/a.ts')).toHaveLength(1);

      // Phase 1 table should be untouched
      const row = rawDb.prepare('SELECT name FROM tech_stack').get() as { name: string };
      expect(row.name).toBe('TypeScript');
    });
  });
});

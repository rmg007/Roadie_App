/**
 * @test migration-corpus.test.ts (B3)
 * @description Opens the pre-seeded v1.db fixture and verifies:
 *   - integrity_check passes
 *   - row count is exactly 5 workflow_history entries
 *   - LearningDatabase initializes successfully from a pre-existing DB
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
import { LearningDatabase } from '../learning/learning-database';

const FIXTURE_PATH = path.join(
  __dirname,
  '../../tests/fixtures/db-corpus/v1.db',
);

describe('B3 — Migration corpus (v1.db fixture)', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const p of temps) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
      // Clean up backup files created during initialize()
      try {
        const dir = path.dirname(p);
        const base = path.basename(p);
        for (const entry of fs.readdirSync(dir)) {
          if (entry.startsWith(base + '.')) {
            fs.unlinkSync(path.join(dir, entry));
          }
        }
      } catch { /* ignore */ }
    }
    temps.length = 0;
  });

  it('v1.db fixture exists', () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);
  });

  it('integrity_check = ok on v1.db copy', () => {
    const tempPath = path.join(os.tmpdir(), `roadie-corpus-${Date.now()}.db`);
    fs.copyFileSync(FIXTURE_PATH, tempPath);
    temps.push(tempPath);

    const db = new DatabaseSync(tempPath);
    const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    db.close();

    expect(row.integrity_check).toBe('ok');
  });

  it('v1.db copy has exactly 5 workflow_history rows', () => {
    const tempPath = path.join(os.tmpdir(), `roadie-corpus-count-${Date.now()}.db`);
    fs.copyFileSync(FIXTURE_PATH, tempPath);
    temps.push(tempPath);

    const db = new DatabaseSync(tempPath);
    const row = db.prepare('SELECT COUNT(*) as cnt FROM workflow_history').get() as { cnt: number };
    db.close();

    expect(row.cnt).toBe(5);
  });

  it('LearningDatabase initializes successfully from v1.db copy', () => {
    const tempPath = path.join(os.tmpdir(), `roadie-corpus-init-${Date.now()}.db`);
    fs.copyFileSync(FIXTURE_PATH, tempPath);
    temps.push(tempPath);

    const db = new DatabaseSync(tempPath);
    const learning = new LearningDatabase();

    expect(() => learning.initialize(db, {}, tempPath)).not.toThrow();

    const size = learning.getDatabaseSize();
    expect(size).toBeGreaterThan(0);

    learning.close();
    db.close();
  });

  it('workflow_history rows survive LearningDatabase initialization', () => {
    const tempPath = path.join(os.tmpdir(), `roadie-corpus-survive-${Date.now()}.db`);
    fs.copyFileSync(FIXTURE_PATH, tempPath);
    temps.push(tempPath);

    const db = new DatabaseSync(tempPath);
    const learning = new LearningDatabase();
    learning.initialize(db, { workflowHistory: true }, tempPath);

    // The 5 pre-seeded rows should still be present after initialization
    const history = learning.getWorkflowHistory(100);
    expect(history).toHaveLength(5);

    const types = history.map((h) => h.workflowType);
    expect(types).toContain('bug_fix');
    expect(types).toContain('feature');
    expect(types).toContain('refactor');
    expect(types).toContain('review');
    expect(types).toContain('document');

    learning.close();
    db.close();
  });
});

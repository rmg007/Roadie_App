/**
 * @test durability.test.ts (B5)
 * @description Verifies SQLite WAL crash-recovery durability:
 *   1. Creates a fresh DB with WAL mode
 *   2. Spawns crash-mid-write.js as a child process (writes 50 rows, no COMMIT)
 *   3. Re-opens the DB after the crash
 *   4. Asserts integrity_check = 'ok'
 *   5. Asserts row count = 0 (uncommitted transaction was never committed)
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const CHAOS_SCRIPT = path.resolve(
  __dirname,
  '../../scripts/chaos/crash-mid-write.js',
);

describe('B5 — WAL crash-recovery durability', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const p of temps) {
      for (const suffix of ['', '-shm', '-wal']) {
        try { fs.unlinkSync(p + suffix); } catch { /* ignore */ }
      }
    }
    temps.length = 0;
  });

  it('integrity_check passes after crash mid-write (uncommitted rows vanish)', () => {
    const dbPath = path.join(os.tmpdir(), `roadie-durability-${Date.now()}.db`);
    temps.push(dbPath);

    // 1. Create a fresh DB with WAL mode + the workflow_history table
    const setup = new DatabaseSync(dbPath);
    setup.exec('PRAGMA journal_mode = WAL');
    setup.exec(`
      CREATE TABLE IF NOT EXISTS workflow_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        steps_completed INTEGER NOT NULL DEFAULT 0,
        steps_total INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        model_tiers_used TEXT,
        error_summary TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    setup.close();

    // 2. Spawn crash-mid-write.js — it writes 50 rows inside a transaction
    //    then exits with code 1 without committing
    const result = spawnSync(process.execPath, [CHAOS_SCRIPT, dbPath], {
      timeout: 10_000,
      encoding: 'utf8',
    });

    // The script should exit with code 1 (simulated crash)
    expect(result.status).toBe(1);

    // 3. Re-open the DB after the crash
    const recovery = new DatabaseSync(dbPath);

    // 4. integrity_check must pass
    const integrityRow = recovery.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    expect(integrityRow.integrity_check).toBe('ok');

    // 5. Row count must be 0 — uncommitted transaction was rolled back
    const countRow = recovery.prepare('SELECT COUNT(*) as cnt FROM workflow_history').get() as { cnt: number };
    expect(countRow.cnt).toBe(0);

    recovery.close();
  });
});

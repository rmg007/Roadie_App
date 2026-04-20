/**
 * @test pragmas.test.ts (B1)
 * @description Verifies that applyPragmas() correctly sets all required SQLite
 *   pragmas on a real temp-file database. Uses a real file (not :memory:) because
 *   WAL mode requires a real filesystem path.
 *
 * Note: applyPragmas() is private, so we test it indirectly via initialize()
 * and then read back pragma values.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
import { LearningDatabase } from '../learning-database';

function createTempDb(): { db: InstanceType<typeof DatabaseSync>; filePath: string } {
  const filePath = path.join(os.tmpdir(), `roadie-pragmas-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(filePath);
  return { db, filePath };
}

describe('B1 — SQLite pragmas (real temp-file DB)', () => {
  const temps: Array<{ db: InstanceType<typeof DatabaseSync>; filePath: string }> = [];

  afterEach(() => {
    for (const { db, filePath } of temps) {
      try { db.close(); } catch { /* ignore */ }
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      // Clean up any backup files
      try {
        const dir = path.dirname(filePath);
        const base = path.basename(filePath);
        for (const entry of fs.readdirSync(dir)) {
          if (entry.startsWith(base + '.')) {
            fs.unlinkSync(path.join(dir, entry));
          }
        }
      } catch { /* ignore */ }
    }
    temps.length = 0;
  });

  it('journal_mode is WAL after initialize()', () => {
    const { db, filePath } = createTempDb();
    temps.push({ db, filePath });

    const learning = new LearningDatabase();
    learning.initialize(db, {}, filePath);

    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(row.journal_mode).toBe('wal');

    learning.close();
  });

  it('foreign_keys is ON after initialize()', () => {
    const { db, filePath } = createTempDb();
    temps.push({ db, filePath });

    const learning = new LearningDatabase();
    learning.initialize(db, {}, filePath);

    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);

    learning.close();
  });

  it('busy_timeout is 5000 after initialize()', () => {
    const { db, filePath } = createTempDb();
    temps.push({ db, filePath });

    const learning = new LearningDatabase();
    learning.initialize(db, {}, filePath);

    const row = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    expect(row.timeout).toBe(5000);

    learning.close();
  });

  it('synchronous is NORMAL (1) after initialize()', () => {
    const { db, filePath } = createTempDb();
    temps.push({ db, filePath });

    const learning = new LearningDatabase();
    learning.initialize(db, {}, filePath);

    const row = db.prepare('PRAGMA synchronous').get() as { synchronous: number };
    // NORMAL = 1
    expect(row.synchronous).toBe(1);

    learning.close();
  });

  it('temp_store is MEMORY (2) after initialize()', () => {
    const { db, filePath } = createTempDb();
    temps.push({ db, filePath });

    const learning = new LearningDatabase();
    learning.initialize(db, {}, filePath);

    const row = db.prepare('PRAGMA temp_store').get() as { temp_store: number };
    // MEMORY = 2
    expect(row.temp_store).toBe(2);

    learning.close();
  });

  it('user_version is set to SCHEMA_VERSION (2) after initialize()', () => {
    const { db, filePath } = createTempDb();
    temps.push({ db, filePath });

    const learning = new LearningDatabase();
    learning.initialize(db, {}, filePath);

    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(2);

    learning.close();
  });

  it('all pragmas are set correctly in a single initialize() call', () => {
    const { db, filePath } = createTempDb();
    temps.push({ db, filePath });

    const learning = new LearningDatabase();
    learning.initialize(db, {}, filePath);

    const journalMode = (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
    const foreignKeys = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys;
    const busyTimeout = (db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout;
    const synchronous = (db.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous;
    const tempStore = (db.prepare('PRAGMA temp_store').get() as { temp_store: number }).temp_store;
    const userVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

    expect(journalMode).toBe('wal');
    expect(foreignKeys).toBe(1);
    expect(busyTimeout).toBe(5000);
    expect(synchronous).toBe(1);
    expect(tempStore).toBe(2);
    expect(userVersion).toBe(2);

    learning.close();
  });
});

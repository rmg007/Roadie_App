// seed-persistence-db.js
//
// Phase 3 E2E — fixture seeder for the persistence suite.
//
// Creates (or refreshes) `.github/.roadie/project-model.db` under
// e2e/fixtures/workspaces/persistence/ with a known set of workflow_history
// rows. The persistence suite opens this workspace, reads the stats count,
// reloads the window, and asserts the count is unchanged.
//
// Schema mirrors src/learning/learning-database.ts. Kept intentionally minimal
// — only the tables `roadie.stats` reads from are created here.
//
// Usage (callable from suites or stand-alone):
//   node e2e/fixtures/seed-persistence-db.js [expected-row-count]
//
// Exit 0 on success, non-zero on seed failure.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const FIXTURE_ROOT = path.join(__dirname, 'workspaces', 'persistence');
const DB_DIR = path.join(FIXTURE_ROOT, '.github', '.roadie');
const DB_PATH = path.join(DB_DIR, 'project-model.db');

const SEED_ROWS = [
  { type: 'feature',  prompt: 'seed-1 build login',    status: 'COMPLETED', done: 7, total: 7, duration: 12_345 },
  { type: 'bug_fix',  prompt: 'seed-2 fix npe',        status: 'COMPLETED', done: 3, total: 3, duration: 4_200  },
  { type: 'feature',  prompt: 'seed-3 export csv',     status: 'FAILED',    done: 2, total: 7, duration: 9_000  },
  { type: 'document', prompt: 'seed-4 document auth',  status: 'COMPLETED', done: 1, total: 1, duration: 1_800  },
];

function seed(expectedCount = SEED_ROWS.length) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  // Remove any stale .db / WAL / SHM so the suite starts from a known state.
  for (const ext of ['', '-wal', '-shm']) {
    const p = DB_PATH + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(`
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
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_type ON workflow_history(workflow_type);
      CREATE TABLE IF NOT EXISTS learning_schema_version (version INTEGER NOT NULL);
    `);
    const insert = db.prepare(
      'INSERT INTO workflow_history (workflow_type, prompt, status, steps_completed, steps_total, duration_ms) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const r of SEED_ROWS) insert.run(r.type, r.prompt, r.status, r.done, r.total, r.duration);

    const n = db.prepare('SELECT COUNT(*) AS n FROM workflow_history').get().n;
    if (n !== expectedCount) {
      throw new Error(`seed-persistence-db: expected ${expectedCount} rows, got ${n}`);
    }
  } finally {
    db.close();
  }

  return { dbPath: DB_PATH, workspaceRoot: FIXTURE_ROOT, rowCount: SEED_ROWS.length };
}

module.exports = { seed, SEED_ROWS, FIXTURE_ROOT, DB_PATH };

if (require.main === module) {
  try {
    const expected = Number(process.argv[2] ?? SEED_ROWS.length);
    const result = seed(expected);
    console.log(`[seed-persistence-db] wrote ${result.rowCount} rows to ${result.dbPath}`);
  } catch (err) {
    console.error('[seed-persistence-db] fatal:', err);
    process.exit(1);
  }
}

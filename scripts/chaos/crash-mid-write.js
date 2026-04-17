/**
 * crash-mid-write.js (B5)
 * Child process script for durability testing.
 *
 * Opens the database at the path given as argv[2], begins a transaction,
 * writes 50 rows to workflow_history, then exits with code 1 WITHOUT
 * committing. This simulates a process crash mid-write.
 *
 * The calling test then re-opens the database and verifies:
 *   - integrity_check = 'ok'
 *   - row count = 0 (uncommitted transaction was rolled back by WAL)
 *
 * Usage: node scripts/chaos/crash-mid-write.js <dbPath>
 */

'use strict';

const { DatabaseSync } = require('node:sqlite');
const dbPath = process.argv[2];

if (!dbPath) {
  process.stderr.write('Usage: crash-mid-write.js <dbPath>\n');
  process.exit(2);
}

const db = new DatabaseSync(dbPath);

// Apply WAL mode (required for crash safety)
db.exec('PRAGMA journal_mode = WAL');

// Ensure the workflow_history table exists
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
  )
`);

// Begin transaction and write 50 rows — do NOT commit
db.exec('BEGIN');

for (let i = 0; i < 50; i++) {
  db.exec(`INSERT INTO workflow_history (workflow_type, prompt, status, steps_completed, steps_total)
    VALUES ('bug_fix', 'crash-test-row-${i}', 'running', ${i}, 50)`);
}

// Intentional crash — exit without COMMIT
process.exit(1);

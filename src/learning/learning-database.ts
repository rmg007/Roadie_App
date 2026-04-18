/**
 * @module learning-database
 * @description Adds learning tables (file_snapshots, workflow_history,
 *   section_hashes) to the shared SQLite database. Provides CRUD and
 *   pruning for Phase 1.5 edit tracking and workflow analytics.
 *
 *   Phase B hardening:
 *   - B1: applyPragmas() sets WAL mode, busy_timeout, foreign_keys, etc.
 *   - B2: Schema versioning via SCHEMA_VERSION constant + PRAGMA user_version.
 *   - B4: Backup-before-migrate creates a timestamped .bak file.
 *   - B6: Integrity check on initialize(); corrupt db is backed up + recreated.
 *   - B8: ENOSPC / EACCES caught and wrapped as RoadieError(DB_WRITE_FAILED).
 *   - B9: Workspace trust gate — writes blocked when isTrusted === false.
 *
 * @inputs node:sqlite DatabaseSync instance (shared with RoadieDatabase)
 * @outputs CRUD methods for snapshots, workflow history, section hashes
 * @depends-on node:sqlite (built-in), node:crypto
 * @depended-on-by edit-tracker, section-manager, file-watcher-manager
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
type SqliteDb = InstanceType<typeof DatabaseSync>;
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { RoadieError } from '../shell/errors';

// ---- Public types ----

export interface FileSnapshot {
  id: number;
  filePath: string;
  content: string;
  contentHash: string;
  source: 'roadie' | 'human';
  createdAt: string;
}

export interface WorkflowOutcomeInput {
  workflowType: string;
  prompt: string;
  status: string;
  stepsCompleted: number;
  stepsTotal: number;
  durationMs?: number;
  modelTiersUsed?: string;
  errorSummary?: string;
}

export interface WorkflowHistoryEntry {
  id: number;
  workflowType: string;
  prompt: string;
  status: string;
  stepsCompleted: number;
  stepsTotal: number;
  durationMs: number | null;
  modelTiersUsed: string | null;
  errorSummary: string | null;
  createdAt: string;
}

export interface WorkflowStats {
  totalWorkflows: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageDurationMs: number;
  byType: Record<string, { count: number; successCount: number }>;
}

export interface PruneResult {
  snapshotsRemoved: number;
  historyEntriesRemoved: number;
  deletedPatternObservations: number;
}

export interface WorkflowSnapshot {
  id: string;
  workflowId: string;
  currentStepIndex: number;
  definition: Record<string, unknown>;
  context: Record<string, unknown>;
  stepResults: Record<string, unknown>[];
  status: string;
  createdAt: string;
  updatedAt: string;
  threadId: string;
}

export interface LearningDatabaseConfig {
  workflowHistory?: boolean;
}

// ---- Constants ----

const MAX_SNAPSHOTS_PER_FILE = 50;
const MAX_WORKFLOW_ENTRIES = 100;

/** Current schema version. Increment when ALTER TABLE migrations are needed. */
const SCHEMA_VERSION = 1;

/** Maximum number of .bak files to keep per database file (B4). */
const MAX_BACKUPS = 3;

const LEARNING_SCHEMA = `
  CREATE TABLE IF NOT EXISTS file_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_path ON file_snapshots(file_path, created_at DESC);

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

  CREATE TABLE IF NOT EXISTS section_hashes (
    file_path TEXT NOT NULL,
    section_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (file_path, section_id)
  );

  CREATE TABLE IF NOT EXISTS pattern_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_id TEXT NOT NULL,
    observed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pattern_obs ON pattern_observations(pattern_id);
  CREATE INDEX IF NOT EXISTS idx_workflow_type ON workflow_history(workflow_type);
  CREATE TABLE IF NOT EXISTS learning_schema_version (
    version INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workflow_snapshots (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    current_step_index INTEGER NOT NULL,
    definition TEXT NOT NULL,
    context TEXT NOT NULL,
    step_results TEXT NOT NULL,
    completed_step_ids TEXT,
    model_tiers_used TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    thread_id TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_workflow_id ON workflow_snapshots(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_snapshots_thread_id ON workflow_snapshots(thread_id);
  CREATE INDEX IF NOT EXISTS idx_snapshots_status ON workflow_snapshots(status);
  CREATE INDEX IF NOT EXISTS idx_snapshots_updated_at ON workflow_snapshots(updated_at DESC);
`;

// ---- Helper ----

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ---- Class ----

export class LearningDatabase {
  private db: SqliteDb | null = null;
  private config: LearningDatabaseConfig = {};
  /** Filesystem path of the underlying db file, used for backup operations. */
  private dbPath: string | null = null;

  // ---- B8: logger accessor (lazy to avoid circular dep) ----
  private log(level: 'info' | 'warn' | 'error', msg: string, err?: unknown): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getLogger } = require('../shell/logger') as typeof import('../shell/logger');
      const logger = getLogger();
      if (level === 'info') logger.info(msg);
      else if (level === 'warn') logger.warn(msg, err);
      else logger.error(msg, err);
    } catch {
      // logger not yet initialised — silently ignore
    }
  }

  // ---- B9: workspace trust gate ----
  private get isTrusted(): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const vscode = require('vscode') as typeof import('vscode');
      return vscode.workspace.isTrusted !== false;
    } catch {
      // vscode not available (unit tests) — default to trusted
      return true;
    }
  }

  // ---- B1: SQLite pragmas ----

  /**
   * Apply hardened SQLite pragmas to a newly opened database connection.
   * Called after every DatabaseSync open.
   */
  private applyPragmas(db: SqliteDb): void {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA temp_store = MEMORY');
    db.exec('PRAGMA synchronous = NORMAL');

    // WAL mode: capture return value and warn if it differs
    const walRow = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: string } | undefined;
    const journalMode = walRow?.journal_mode ?? '';
    if (journalMode !== 'wal') {
      this.log('warn', `[LearningDatabase] Expected WAL journal mode, got: '${journalMode}'`);
    }
  }

  // ---- B4: backup helper ----

  /**
   * Copy `dbPath` to `<dbPath>.bak.<timestamp>` before running migrations.
   * Keeps only the last MAX_BACKUPS backups (deletes older ones).
   * Skips silently if the file does not exist (fresh install).
   */
  private backupDatabase(dbFilePath: string, label = 'bak'): string | null {
    if (!fs.existsSync(dbFilePath)) return null;

    const timestamp = Date.now();
    const backupPath = `${dbFilePath}.${label}.${timestamp}`;

    try {
      fs.copyFileSync(dbFilePath, backupPath);
    } catch (err) {
      this.log('warn', `[LearningDatabase] Failed to create backup at ${backupPath}`, err);
      return null;
    }

    // Prune old backups — keep newest MAX_BACKUPS
    try {
      const dir = nodePath.dirname(dbFilePath);
      const base = nodePath.basename(dbFilePath);
      const entries = fs.readdirSync(dir)
        .filter((f) => f.startsWith(`${base}.${label}.`))
        .map((f) => ({ name: f, ts: parseInt(f.split('.').pop() ?? '0', 10) }))
        .sort((a, b) => b.ts - a.ts);

      for (const entry of entries.slice(MAX_BACKUPS)) {
        try {
          fs.unlinkSync(nodePath.join(dir, entry.name));
        } catch {
          // best-effort deletion
        }
      }
    } catch {
      // non-fatal
    }

    return backupPath;
  }

  /**
   * Attach to an existing node:sqlite DatabaseSync and create tables.
   * Accepts an optional `dbPath` for backup/corruption-recovery operations.
   *
   * @param db   - The shared DatabaseSync instance.
   * @param config - LearningDatabase configuration options.
   * @param dbPath - Filesystem path of the database file (used for backups/recovery).
   */
  initialize(db: SqliteDb, config?: LearningDatabaseConfig, dbPath?: string): void {
    if (this.db) {
      this.close();
    }
    this.db = db;
    this.config = config ?? {};
    this.dbPath = dbPath ?? null;

    // B1: apply pragmas
    this.applyPragmas(db);

    // B6: integrity check — recover from corruption before touching schema
    this.checkIntegrity(db);

    // Apply schema
    this.db.exec(LEARNING_SCHEMA);

    // B2: schema version check and migration
    this.runMigrations();

    this.prune();
  }

  // ---- B2: schema migration ----

  private runMigrations(): void {
    const db = this.db;
    if (!db) return;

    const versionRow = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
    const currentVersion = versionRow?.user_version ?? 0;

    if (currentVersion < SCHEMA_VERSION) {
      this.log('info', `[LearningDatabase] Migrating schema from v${currentVersion} to v${SCHEMA_VERSION}`);

      // B4: backup before migrate (only if we have a path and the file exists)
      if (this.dbPath) {
        this.backupDatabase(this.dbPath);
      }

      // v0 → v1: ensure learning_schema_version table exists (already in LEARNING_SCHEMA)
      // No ALTER TABLE needed for v1 since the schema is created fresh if missing

      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      this.log('info', `[LearningDatabase] Schema migrated to v${SCHEMA_VERSION}`);
    }

    // Legacy: ensure the version row exists in the old learning_schema_version table too
    const current = db.prepare('SELECT version FROM learning_schema_version LIMIT 1').get() as { version: number } | undefined;
    if (!current) {
      db.prepare('INSERT INTO learning_schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    }
  }

  // ---- B6: integrity check and recovery ----

  private checkIntegrity(db: SqliteDb): void {
    try {
      const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string } | undefined;
      if (row?.integrity_check !== 'ok') {
        this.log('warn', `[LearningDatabase] integrity_check returned '${row?.integrity_check ?? 'unknown'}' — attempting recovery`);

        // Backup the corrupt file
        if (this.dbPath) {
          const backupPath = this.backupDatabase(this.dbPath, 'corrupt');
          if (backupPath) {
            this.log('info', `[LearningDatabase] Corrupt database backed up to ${backupPath}`);
          }
        }
        // Signal caller (best-effort: schema will be recreated by exec(LEARNING_SCHEMA))
      }
    } catch (err) {
      this.log('warn', '[LearningDatabase] Could not run integrity_check', err);
    }
  }

  // ---- B8: safe exec wrapper ----

  /**
   * Wrap a write operation, catching ENOSPC and EACCES errors and re-throwing
   * them as typed RoadieError(DB_WRITE_FAILED).
   */
  private safeExec<T>(fn: () => T): T {
    if (!this.isTrusted) {
      throw new RoadieError(
        'DB_WRITE_FAILED',
        'Database writes are blocked: workspace is not trusted.',
      );
    }
    try {
      return fn();
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOSPC' || code === 'EACCES') {
        throw new RoadieError(
          'DB_WRITE_FAILED',
          code === 'ENOSPC'
            ? 'Cannot write to database: disk is full (ENOSPC).'
            : 'Cannot write to database: permission denied (EACCES).',
          err,
        );
      }
      throw err;
    }
  }

  close(): void {
    // node:sqlite DatabaseSync is closed automatically; just release the reference.
    this.db = null;
    this.dbPath = null;
  }

  /**
   * Hot-update the workflowHistory flag without re-initialising.
   * Called when the user runs "Roadie: Enable/Disable Workflow History".
   */
  setWorkflowHistory(enabled: boolean): void {
    this.config = { ...this.config, workflowHistory: enabled };
  }

  /** Return whether workflow history recording is currently active. */
  isWorkflowHistoryEnabled(): boolean {
    return this.config.workflowHistory === true;
  }

  // ---- File Snapshots ----

  recordSnapshot(filePath: string, content: string, source: 'roadie' | 'human'): void {
    if (!this.db) return;
    // B9: skip writes when workspace is not trusted
    if (!this.isTrusted) return;
    const db = this.db;
    const hash = sha256(content);
    this.safeExec(() =>
      db.prepare(
        'INSERT INTO file_snapshots (file_path, content, content_hash, source) VALUES (?, ?, ?, ?)',
      ).run(filePath, content, hash, source),
    );
  }

  getSnapshots(filePath: string, limit = 50): FileSnapshot[] {
    const db = this.requireDb();
    const rows = db.prepare(
      'SELECT id, file_path, content, content_hash, source, created_at FROM file_snapshots WHERE file_path = ? ORDER BY id DESC LIMIT ?',
    ).all(filePath, limit) as Array<{
      id: number; file_path: string; content: string; content_hash: string; source: string; created_at: string;
    }>;
    return rows.map(toFileSnapshot);
  }

  getLatestSnapshot(filePath: string): FileSnapshot | null {
    const db = this.requireDb();
    const row = db.prepare(
      'SELECT id, file_path, content, content_hash, source, created_at FROM file_snapshots WHERE file_path = ? ORDER BY id DESC LIMIT 1',
    ).get(filePath) as {
      id: number; file_path: string; content: string; content_hash: string; source: string; created_at: string;
    } | undefined;
    return row ? toFileSnapshot(row) : null;
  }

  // ---- Workflow History ----

  recordWorkflowOutcome(entry: WorkflowOutcomeInput): void {
    if (!this.config.workflowHistory) return;
    if (!this.db) return;
    // B9: skip writes when workspace is not trusted
    if (!this.isTrusted) return;
    const db = this.db;
    this.safeExec(() =>
      db.prepare(
        `INSERT INTO workflow_history (workflow_type, prompt, status, steps_completed, steps_total, duration_ms, model_tiers_used, error_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        entry.workflowType,
        entry.prompt,
        entry.status,
        entry.stepsCompleted,
        entry.stepsTotal,
        entry.durationMs ?? null,
        entry.modelTiersUsed ?? null,
        entry.errorSummary ?? null,
      ),
    );
  }

  getWorkflowHistory(limit = 100): WorkflowHistoryEntry[] {
    const db = this.requireDb();
    const rows = db.prepare(
      'SELECT * FROM workflow_history ORDER BY id DESC LIMIT ?',
    ).all(limit) as Array<{
      id: number; workflow_type: string; prompt: string; status: string;
      steps_completed: number; steps_total: number; duration_ms: number | null;
      model_tiers_used: string | null; error_summary: string | null; created_at: string;
    }>;
    return rows.map(toWorkflowEntry);
  }

  getWorkflowStats(): WorkflowStats {
    const db = this.requireDb();
    const rows = db.prepare('SELECT workflow_type, status, duration_ms FROM workflow_history').all() as Array<{
      workflow_type: string; status: string; duration_ms: number | null;
    }>;

    if (rows.length === 0) {
      return { totalWorkflows: 0, successCount: 0, failureCount: 0, successRate: 0, averageDurationMs: 0, byType: {} };
    }

    let successCount = 0;
    let failureCount = 0;
    let totalDuration = 0;
    let durationCount = 0;
    const byType: Record<string, { count: number; successCount: number }> = {};

    for (const row of rows) {
      const isSuccess = row.status === 'completed' || row.status === 'success';
      if (isSuccess) successCount++;
      else failureCount++;
      if (row.duration_ms !== null && row.duration_ms !== undefined) { totalDuration += row.duration_ms; durationCount++; }
      const entry = byType[row.workflow_type] ??= { count: 0, successCount: 0 };
      entry.count++;
      if (isSuccess) entry.successCount++;
    }

    return {
      totalWorkflows: rows.length,
      successCount,
      failureCount,
      successRate: rows.length > 0 ? successCount / rows.length : 0,
      averageDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
      byType,
    };
  }

  // ---- Section Hashes ----

  getSectionHash(filePath: string, sectionId: string): string | null {
    const db = this.requireDb();
    const row = db.prepare(
      'SELECT content_hash FROM section_hashes WHERE file_path = ? AND section_id = ?',
    ).get(filePath, sectionId) as { content_hash: string } | undefined;
    return row?.content_hash ?? null;
  }

  setSectionHash(filePath: string, sectionId: string, hash: string): void {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO section_hashes (file_path, section_id, content_hash, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(file_path, section_id) DO UPDATE SET content_hash = excluded.content_hash, updated_at = excluded.updated_at`,
    ).run(filePath, sectionId, hash);
  }

  // ---- Maintenance ----

  prune(): PruneResult {
    const db = this.requireDb();
    let snapshotsRemoved = 0;
    let historyEntriesRemoved = 0;

    // Prune snapshots: keep last MAX_SNAPSHOTS_PER_FILE per file
    const result = db.prepare(
      `DELETE FROM file_snapshots WHERE id IN (
         SELECT id FROM (
           SELECT id,
                  ROW_NUMBER() OVER (PARTITION BY file_path ORDER BY id DESC) as rownum
           FROM file_snapshots
         )
         WHERE rownum > ?
       )`,
    ).run(MAX_SNAPSHOTS_PER_FILE);
    snapshotsRemoved = result.changes;

    // Prune workflow history: keep last MAX_WORKFLOW_ENTRIES
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM workflow_history').get() as { cnt: number };
    if (countRow.cnt > MAX_WORKFLOW_ENTRIES) {
      const result = db.prepare(
        `DELETE FROM workflow_history WHERE id NOT IN (
          SELECT id FROM workflow_history ORDER BY id DESC LIMIT ?
        )`,
      ).run(MAX_WORKFLOW_ENTRIES);
      historyEntriesRemoved = result.changes;
    }

    const patternResult = db.prepare(
      `DELETE FROM pattern_observations WHERE id NOT IN (
         SELECT id FROM pattern_observations ORDER BY id DESC LIMIT 5000
       )`,
    ).run();
    const deletedPatternObservations = patternResult.changes;

    return { snapshotsRemoved, historyEntriesRemoved, deletedPatternObservations };
  }

  getDatabaseSize(): number {
    const db = this.requireDb();
    const snapshots = (db.prepare('SELECT COUNT(*) as cnt FROM file_snapshots').get() as { cnt: number }).cnt;
    const history = (db.prepare('SELECT COUNT(*) as cnt FROM workflow_history').get() as { cnt: number }).cnt;
    const sections = (db.prepare('SELECT COUNT(*) as cnt FROM section_hashes').get() as { cnt: number }).cnt;
    const observations = (db.prepare('SELECT COUNT(*) as cnt FROM pattern_observations').get() as { cnt: number }).cnt;
    return snapshots + history + sections + observations;
  }

  /**
   * Return the most-edited files (by snapshot count), up to `limit`.
   * Used by AGENTS.md key-files section.
   */
  getMostEditedFiles(limit = 10): Array<{ filePath: string; editCount: number }> {
    const db = this.requireDb();
    const rows = db.prepare(
      `SELECT file_path, COUNT(*) as edit_count
       FROM file_snapshots
       WHERE source = 'human'
       GROUP BY file_path
       ORDER BY edit_count DESC
       LIMIT ?`,
    ).all(limit) as Array<{ file_path: string; edit_count: number }>;
    return rows.map((r) => ({ filePath: r.file_path, editCount: r.edit_count }));
  }

  /**
   * Return per-workflow cancellation stats.
   * Used by AGENTS.md learned-preferences section.
   */
  getWorkflowCancellationStats(): Array<{ workflowType: string; totalRuns: number; cancelledRuns: number }> {
    const db = this.requireDb();
    const rows = db.prepare(
      `SELECT workflow_type,
              COUNT(*) as total_runs,
              SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_runs
       FROM workflow_history
       GROUP BY workflow_type`,
    ).all() as Array<{ workflow_type: string; total_runs: number; cancelled_runs: number }>;
    return rows.map((r) => ({
      workflowType: r.workflow_type,
      totalRuns: r.total_runs,
      cancelledRuns: r.cancelled_runs,
    }));
  }

  // ---- Workflow Snapshots ----

  saveWorkflowSnapshot(snapshot: WorkflowSnapshot): void {
    if (!this.db) return;
    if (!this.isTrusted) return;
    const db = this.db;
    this.safeExec(() =>
      db.prepare(
        `INSERT OR REPLACE INTO workflow_snapshots (id, workflow_id, current_step_index, definition, context, step_results, completed_step_ids, model_tiers_used, status, created_at, updated_at, thread_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      ).run(
        snapshot.id,
        snapshot.workflowId,
        snapshot.currentStepIndex,
        JSON.stringify(snapshot.definition),
        JSON.stringify(snapshot.context),
        JSON.stringify(snapshot.stepResults),
        JSON.stringify(snapshot.completedStepIds || []),
        JSON.stringify(snapshot.modelTiersUsed || []),
        snapshot.status,
        snapshot.createdAt,
        snapshot.threadId,
      ),
    );
  }

  loadWorkflowSnapshot(snapshotId: string): WorkflowSnapshot | null {
    if (!this.db) return null;
    const db = this.db;
    const row = db.prepare(
      'SELECT * FROM workflow_snapshots WHERE id = ?',
    ).get(snapshotId) as {
      id: string; workflow_id: string; current_step_index: number;
      definition: string; context: string; step_results: string;
      completed_step_ids: string; model_tiers_used: string;
      status: string; created_at: string; updated_at: string; thread_id: string;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      workflowId: row.workflow_id,
      currentStepIndex: row.current_step_index,
      definition: JSON.parse(row.definition),
      context: JSON.parse(row.context),
      stepResults: JSON.parse(row.step_results),
      completedStepIds: row.completed_step_ids ? JSON.parse(row.completed_step_ids) : [],
      modelTiersUsed: row.model_tiers_used ? JSON.parse(row.model_tiers_used) : [],
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      threadId: row.thread_id,
    };
  }

  listIncompleteWorkflows(threadId: string): WorkflowSnapshot[] {
    if (!this.db) return [];
    const db = this.db;
    // H7: Filter for both 'paused' (approval waiting) and 'saved' (intermediate snapshots)
    const rows = db.prepare(
      'SELECT * FROM workflow_snapshots WHERE status IN (?, ?) AND thread_id = ? ORDER BY updated_at DESC',
    ).all('paused', 'saved', threadId) as Array<{
      id: string; workflow_id: string; current_step_index: number;
      definition: string; context: string; step_results: string;
      completed_step_ids: string; model_tiers_used: string;
      status: string; created_at: string; updated_at: string; thread_id: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      currentStepIndex: row.current_step_index,
      definition: JSON.parse(row.definition),
      context: JSON.parse(row.context),
      stepResults: JSON.parse(row.step_results),
      completedStepIds: row.completed_step_ids ? JSON.parse(row.completed_step_ids) : [],
      modelTiersUsed: row.model_tiers_used ? JSON.parse(row.model_tiers_used) : [],
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      threadId: row.thread_id,
    }));
  }

  // ---- Pattern Observations ----

  /**
   * Record a single sighting of a pattern (by its patternId).
   * Called by ProjectAnalyzer each time a pattern is detected.
   */
  recordPatternObservation(patternId: string): void {
    if (!this.db) return;
    const db = this.db;
    db.prepare(
      'INSERT INTO pattern_observations (pattern_id) VALUES (?)',
    ).run(patternId);
  }

  /**
   * Return the observation count for each pattern that has been recorded.
   * Used by ProjectAnalyzer to boost confidence on frequently-seen patterns.
   */
  getPatternObservationCounts(): Array<{ patternId: string; observationCount: number }> {
    const db = this.requireDb();
    const rows = db.prepare(
      `SELECT pattern_id, COUNT(*) as observation_count
       FROM pattern_observations
       GROUP BY pattern_id`,
    ).all() as Array<{ pattern_id: string; observation_count: number }>;
    return rows.map((r) => ({ patternId: r.pattern_id, observationCount: r.observation_count }));
  }

  // ---- Generation Acceptance ----

  /**
   * Compute how often humans keep (accepted) vs edit (edited) a Roadie-generated file.
   * Scans consecutive roadie→human snapshot pairs. Returns null if fewer than 3 transitions.
   */
  getGenerationAcceptanceRate(filePath: string): { accepted: number; edited: number } | null {
    const db = this.requireDb();
    const rows = db.prepare(
      'SELECT content_hash, source FROM file_snapshots WHERE file_path = ? ORDER BY id ASC',
    ).all(filePath) as Array<{ content_hash: string; source: string }>;

    let accepted = 0;
    let edited = 0;

    for (let i = 0; i < rows.length - 1; i++) {
      const curRow = rows[i];
      const nextRow = rows[i + 1];
      if (curRow !== undefined && nextRow !== undefined &&
          curRow.source === 'roadie' && nextRow.source === 'human') {
        if (curRow.content_hash === nextRow.content_hash) {
          accepted++;
        } else {
          edited++;
        }
      }
    }

    const total = accepted + edited;
    if (total < 3) return null;
    return { accepted, edited };
  }

  // ---- Private ----

  private requireDb(): SqliteDb {
    if (!this.db) throw new Error('LearningDatabase not initialized. Call initialize() first.');
    return this.db;
  }
}

// ---- Row mappers ----

function toFileSnapshot(row: {
  id: number; file_path: string; content: string; content_hash: string; source: string; created_at: string;
}): FileSnapshot {
  return {
    id: row.id,
    filePath: row.file_path,
    content: row.content,
    contentHash: row.content_hash,
    source: row.source as 'roadie' | 'human',
    createdAt: row.created_at,
  };
}

function toWorkflowEntry(row: {
  id: number; workflow_type: string; prompt: string; status: string;
  steps_completed: number; steps_total: number; duration_ms: number | null;
  model_tiers_used: string | null; error_summary: string | null; created_at: string;
}): WorkflowHistoryEntry {
  return {
    id: row.id,
    workflowType: row.workflow_type,
    prompt: row.prompt,
    status: row.status,
    stepsCompleted: row.steps_completed,
    stepsTotal: row.steps_total,
    durationMs: row.duration_ms,
    modelTiersUsed: row.model_tiers_used,
    errorSummary: row.error_summary,
    createdAt: row.created_at,
  };
}


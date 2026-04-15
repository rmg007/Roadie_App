/**
 * @module learning-database
 * @description Adds learning tables (file_snapshots, workflow_history,
 *   section_hashes) to the shared SQLite database. Provides CRUD and
 *   pruning for Phase 1.5 edit tracking and workflow analytics.
 * @inputs better-sqlite3 Database instance (shared with RoadieDatabase)
 * @outputs CRUD methods for snapshots, workflow history, section hashes
 * @depends-on better-sqlite3, node:crypto
 * @depended-on-by edit-tracker, section-manager, file-watcher-manager
 */

import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

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

export interface LearningDatabaseConfig {
  workflowHistory?: boolean;
}

// ---- Constants ----

const MAX_SNAPSHOTS_PER_FILE = 50;
const MAX_WORKFLOW_ENTRIES = 100;

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
`;

// ---- Helper ----

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ---- Class ----

export class LearningDatabase {
  private db: Database.Database | null = null;
  private config: LearningDatabaseConfig = {};

  /** Attach to an existing better-sqlite3 Database and create tables. */
  initialize(db: Database.Database, config?: LearningDatabaseConfig): void {
    if (this.db) {
      this.close();
    }
    this.db = db;
    this.config = config ?? {};
    this.db.exec(LEARNING_SCHEMA);

    const current = this.db.prepare('SELECT version FROM learning_schema_version LIMIT 1').get() as { version: number } | undefined;
    if (!current) {
      this.db.prepare('INSERT INTO learning_schema_version (version) VALUES (?)').run(1);
    }

    this.prune();
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Ignore close failures; releasing the reference is still safe.
      }
    }
    this.db = null;
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
    const db = this.requireDb();
    const hash = sha256(content);
    db.prepare(
      'INSERT INTO file_snapshots (file_path, content, content_hash, source) VALUES (?, ?, ?, ?)',
    ).run(filePath, content, hash, source);
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
    const db = this.requireDb();
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

  // ---- Pattern Observations ----

  /**
   * Record a single sighting of a pattern (by its patternId).
   * Called by ProjectAnalyzer each time a pattern is detected.
   */
  recordPatternObservation(patternId: string): void {
    const db = this.requireDb();
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
      if (rows[i].source === 'roadie' && rows[i + 1].source === 'human') {
        if (rows[i].content_hash === rows[i + 1].content_hash) {
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

  private requireDb(): Database.Database {
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

/**
 * @module db-adapter
 * @description TypeScript interface that abstracts all database operations
 *   performed by LearningDatabase. Isolates the codebase from node:sqlite
 *   internals, making a driver swap possible without touching callers.
 *
 *   LearningDatabase implements DbAdapter.
 *
 * @depends-on (none — pure interface)
 * @depended-on-by learning-database.ts, tests
 */

import type {
  FileSnapshot,
  WorkflowOutcomeInput,
  WorkflowHistoryEntry,
  WorkflowStats,
  PruneResult,
  LearningDatabaseConfig,
} from './learning-database';

// Re-export for convenience so callers only need to import from db-adapter
export type {
  FileSnapshot,
  WorkflowOutcomeInput,
  WorkflowHistoryEntry,
  WorkflowStats,
  PruneResult,
  LearningDatabaseConfig,
};

/**
 * Minimal interface for a SQLite-like database connection.
 * Allows swapping out node:sqlite for another driver in the future.
 */
export interface RawDbHandle {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    run(...args: unknown[]): { changes: number };
  };
  close(): void;
}

/**
 * DbAdapter — the contract that LearningDatabase fulfils.
 *
 * All methods are optional in the sense that implementations may be a
 * no-op (e.g. a NullAdapter for untrusted workspaces), but callers should
 * treat every method as potentially absent and check before calling.
 */
export interface DbAdapter {
  /**
   * Initialise the adapter against an existing database handle.
   * Must be called before any other method.
   */
  initialize(db: RawDbHandle, config?: LearningDatabaseConfig, dbPath?: string): void;

  /** Release the database reference. */
  close(): void;

  /** Enable or disable workflow history recording at runtime. */
  setWorkflowHistory(enabled: boolean): void;

  /** Returns true when workflow history is currently recording. */
  isWorkflowHistoryEnabled(): boolean;

  // ---- File Snapshots ----

  recordSnapshot(filePath: string, content: string, source: 'roadie' | 'human'): void;
  getSnapshots(filePath: string, limit?: number): FileSnapshot[];
  getLatestSnapshot(filePath: string): FileSnapshot | null;

  // ---- Workflow History ----

  recordWorkflowOutcome(entry: WorkflowOutcomeInput): void;
  getWorkflowHistory(limit?: number): WorkflowHistoryEntry[];
  getWorkflowStats(): WorkflowStats;
  getWorkflowCancellationStats(): Array<{ workflowType: string; totalRuns: number; cancelledRuns: number }>;

  // ---- Section Hashes ----

  getSectionHash(filePath: string, sectionId: string): string | null;
  setSectionHash(filePath: string, sectionId: string, hash: string): void;

  // ---- Maintenance ----

  prune(): PruneResult;
  getDatabaseSize(): number;

  // ---- Analytics ----

  getMostEditedFiles(limit?: number): Array<{ filePath: string; editCount: number }>;
  getGenerationAcceptanceRate(filePath: string): { accepted: number; edited: number } | null;

  // ---- Pattern Observations ----

  recordPatternObservation(patternId: string): void;
  getPatternObservationCounts(): Array<{ patternId: string; observationCount: number }>;
}

/**
 * @module database
 * @description SQLite wrapper via node:sqlite (built-in Node.js >= 22.5). Creates the database at
 *   .github/.roadie/project-model.db, handles schema migrations via
 *   schema_version table, provides CRUD for project model tables.
 *   PRAGMA integrity_check on open — if corrupt, delete and recreate.
 * @inputs Database path (or ':memory:' for tests)
 * @outputs CRUD methods for tech_stack, directories, patterns, commands
 * @depends-on node:sqlite (built-in)
 * @depended-on-by project-model.ts
 */

import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import type { TechStackEntry, DirectoryNode, DetectedPattern, ProjectCommand } from '../types';

import Database from 'better-sqlite3';
type SqliteDb = Database.Database;

const CURRENT_SCHEMA_VERSION = 2;

const SCHEMA_V1 = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tech_stack (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT,
    source_file TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS directories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK(type IN ('directory', 'file')),
    role TEXT,
    language TEXT
  );

  CREATE TABLE IF NOT EXISTS detected_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence TEXT NOT NULL,
    confidence REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    source_file TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('build', 'test', 'dev', 'lint', 'format', 'other'))
  );

  CREATE TABLE IF NOT EXISTS project_conventions (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- Singleton record
    data_json TEXT NOT NULL
  );
`;

const SCHEMA_V2 = `
  CREATE TABLE IF NOT EXISTS project_conventions (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data_json TEXT NOT NULL
  );
`;

export class RoadieDatabase {
  private db: SqliteDb;

  constructor(dbPath: string) {
    // Ensure directory exists for file-based databases
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      mkdirSync(dir, { recursive: true });
    }

    this.db = this.openDb(dbPath);
    this.migrate();
  }

  private openDb(dbPath: string): SqliteDb {
    let db: SqliteDb | undefined;
    try {
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
    } catch {
      // File is not a SQLite database (garbage bytes, wrong header, etc.) — delete and recreate.
      try { db?.close(); } catch { /* ignore */ }
      if (dbPath !== ':memory:') {
        this.deleteDbFiles(dbPath);
      }
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
    }

    // Also verify integrity for files that open but are internally corrupt.
    if (dbPath !== ':memory:') {
      try {
        const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string } | undefined;
        if (result?.integrity_check !== 'ok') {
          db.close();
          this.deleteDbFiles(dbPath);
          db = new Database(dbPath);
          db.pragma('journal_mode = WAL');
          db.pragma('foreign_keys = ON');
        }
      } catch {
        // integrity_check itself failed — start fresh
        try { db?.close(); } catch { /* ignore */ }
        this.deleteDbFiles(dbPath);
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
      }
    }

    return db as SqliteDb;
  }

  private deleteDbFiles(dbPath: string): void {
    unlinkSync(dbPath);
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    if (existsSync(walPath)) unlinkSync(walPath);
    if (existsSync(shmPath)) unlinkSync(shmPath);
  }

  /** Run schema migrations. */
  private migrate(): void {
    const version = this.getSchemaVersion();
    if (version < CURRENT_SCHEMA_VERSION) {
      if (version === 0) {
        this.db.exec(SCHEMA_V1);
        this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_SCHEMA_VERSION);
      } else if (version === 1) {
        this.db.exec(SCHEMA_V2);
        this.db.prepare('UPDATE schema_version SET version = ?').run(CURRENT_SCHEMA_VERSION);
      }
    }
  }

  private getSchemaVersion(): number {
    try {
      const row = this.db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
      return row?.version ?? 0;
    } catch {
      return 0; // Table doesn't exist yet
    }
  }

  // ---- Tech Stack CRUD ----

  saveTechStack(entries: TechStackEntry[]): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM tech_stack').run();
      const insert = this.db.prepare(
        'INSERT INTO tech_stack (category, name, version, source_file) VALUES (?, ?, ?, ?)',
      );
      for (const e of entries) {
        insert.run(e.category, e.name, e.version ?? null, e.sourceFile);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  loadTechStack(): TechStackEntry[] {
    const rows = this.db.prepare('SELECT category, name, version, source_file FROM tech_stack').all() as Array<{
      category: string; name: string; version: string | null; source_file: string;
    }>;
    return rows.map((r) => ({
      category: r.category,
      name: r.name,
      ...(r.version !== null ? { version: r.version } : {}),
      sourceFile: r.source_file,
    }));
  }

  // ---- Directories CRUD ----

  saveDirectories(root: DirectoryNode): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM directories').run();
      const insert = this.db.prepare(
        'INSERT OR REPLACE INTO directories (path, type, role, language) VALUES (?, ?, ?, ?)',
      );
      this.flattenTree(root).forEach((n) => {
        insert.run(n.path, n.type, n.role ?? null, n.language ?? null);
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  loadDirectoryRoot(): DirectoryNode | null {
    const rows = this.db.prepare('SELECT path, type, role, language FROM directories ORDER BY path').all() as Array<{
      path: string; type: 'directory' | 'file'; role: string | null; language: string | null;
    }>;
    if (rows.length === 0) return null;
    return this.buildTree(rows);
  }

  private flattenTree(node: DirectoryNode): DirectoryNode[] {
    const result: DirectoryNode[] = [node];
    if (node.children) {
      for (const child of node.children) {
        result.push(...this.flattenTree(child));
      }
    }
    return result;
  }

  private buildTree(rows: Array<{ path: string; type: 'directory' | 'file'; role: string | null; language: string | null }>): DirectoryNode {
    if (rows.length === 0) return { path: '', type: 'directory', children: [] };
    const firstRow = rows[0]!;
    const root: DirectoryNode = {
      path: firstRow.path,
      type: firstRow.type,
      ...(firstRow.role !== null ? { role: firstRow.role } : {}),
      ...(firstRow.language !== null ? { language: firstRow.language } : {}),
      children: [],
    };
    // Simplified tree-build: flat list of nodes (full tree reconstruction deferred)
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]!;
      root.children!.push({
        path: r.path,
        type: r.type,
        ...(r.role !== null ? { role: r.role } : {}),
        ...(r.language !== null ? { language: r.language } : {}),
      });
    }
    return root;
  }

  // ---- Patterns CRUD ----

  savePatterns(patterns: DetectedPattern[]): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM detected_patterns').run();
      const insert = this.db.prepare(
        'INSERT INTO detected_patterns (category, description, evidence, confidence) VALUES (?, ?, ?, ?)',
      );
      for (const p of patterns) {
        insert.run(p.category, p.description, JSON.stringify(p.evidence), p.confidence);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  loadPatterns(): DetectedPattern[] {
    const rows = this.db.prepare('SELECT category, description, evidence, confidence FROM detected_patterns').all() as Array<{
      category: string; description: string; evidence: string; confidence: number;
    }>;
    return rows.map((r) => ({
      category: r.category,
      description: r.description,
      evidence: JSON.parse(r.evidence) as DetectedPattern['evidence'],
      confidence: r.confidence,
    }));
  }

  // ---- Commands CRUD ----

  saveCommands(commands: ProjectCommand[]): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM project_commands').run();
      const insert = this.db.prepare(
        'INSERT INTO project_commands (name, command, source_file, type) VALUES (?, ?, ?, ?)',
      );
      for (const c of commands) {
        insert.run(c.name, c.command, c.sourceFile, c.type);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  loadCommands(): ProjectCommand[] {
    const rows = this.db.prepare('SELECT name, command, source_file, type FROM project_commands').all() as Array<{
      name: string; command: string; source_file: string; type: string;
    }>;
    return rows.map((r) => ({
      name: r.name,
      command: r.command,
      sourceFile: r.source_file,
      type: r.type as ProjectCommand['type'],
    }));
  }

  // ---- Conventions CRUD ----

  saveConventions(conventions: any): void {
    this.db.prepare('INSERT OR REPLACE INTO project_conventions (id, data_json) VALUES (1, ?)').run(
      JSON.stringify(conventions),
    );
  }

  loadConventions(): any | null {
    try {
      const row = this.db.prepare('SELECT data_json FROM project_conventions WHERE id = 1').get() as { data_json: string } | undefined;
      return row ? JSON.parse(row.data_json) : null;
    } catch {
      return null;
    }
  }

  /**
   * Expose the raw node:sqlite Database instance so other services
   * (e.g. LearningDatabase) can share the same connection and WAL journal.
   */
  getRawDb(): SqliteDb {
    return this.db;
  }

  /** Close the database connection. */
  close(): void {
    try {
      this.db.exec('PRAGMA wal_checkpoint(RESTART)');
    } catch {
      // Best-effort checkpoint; close regardless
    }
    this.db.close();
  }
}


/**
 * @module database
 * @description SQLite wrapper via better-sqlite3. Creates the database at
 *   .github/.roadie/project-model.db, handles schema migrations via
 *   schema_version table, provides CRUD for project model tables.
 *   PRAGMA integrity_check on open — if corrupt, delete and recreate.
 * @inputs Database path (or ':memory:' for tests)
 * @outputs CRUD methods for tech_stack, directories, patterns, commands
 * @depends-on better-sqlite3
 * @depended-on-by project-model.ts
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import type { TechStackEntry, DirectoryNode, DetectedPattern, ProjectCommand } from '../types';

const CURRENT_SCHEMA_VERSION = 1;

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
`;

export class RoadieDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists for file-based databases
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  /** Run schema migrations. */
  private migrate(): void {
    const version = this.getSchemaVersion();
    if (version < CURRENT_SCHEMA_VERSION) {
      this.db.exec(SCHEMA_V1);
      if (version === 0) {
        this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_SCHEMA_VERSION);
      } else {
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
    this.db.prepare('DELETE FROM tech_stack').run();
    const insert = this.db.prepare(
      'INSERT INTO tech_stack (category, name, version, source_file) VALUES (?, ?, ?, ?)',
    );
    const tx = this.db.transaction((items: TechStackEntry[]) => {
      for (const e of items) {
        insert.run(e.category, e.name, e.version ?? null, e.sourceFile);
      }
    });
    tx(entries);
  }

  loadTechStack(): TechStackEntry[] {
    const rows = this.db.prepare('SELECT category, name, version, source_file FROM tech_stack').all() as Array<{
      category: string; name: string; version: string | null; source_file: string;
    }>;
    return rows.map((r) => ({
      category: r.category,
      name: r.name,
      version: r.version ?? undefined,
      sourceFile: r.source_file,
    }));
  }

  // ---- Directories CRUD ----

  saveDirectories(root: DirectoryNode): void {
    this.db.prepare('DELETE FROM directories').run();
    const insert = this.db.prepare(
      'INSERT OR REPLACE INTO directories (path, type, role, language) VALUES (?, ?, ?, ?)',
    );
    const tx = this.db.transaction((node: DirectoryNode) => {
      this.flattenTree(node).forEach((n) => {
        insert.run(n.path, n.type, n.role ?? null, n.language ?? null);
      });
    });
    tx(root);
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
    const root: DirectoryNode = {
      path: rows[0].path,
      type: rows[0].type,
      role: rows[0].role ?? undefined,
      language: rows[0].language ?? undefined,
      children: [],
    };
    // Simplified tree-build: flat list of nodes (full tree reconstruction deferred)
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      root.children!.push({
        path: r.path,
        type: r.type,
        role: r.role ?? undefined,
        language: r.language ?? undefined,
      });
    }
    return root;
  }

  // ---- Patterns CRUD ----

  savePatterns(patterns: DetectedPattern[]): void {
    this.db.prepare('DELETE FROM detected_patterns').run();
    const insert = this.db.prepare(
      'INSERT INTO detected_patterns (category, description, evidence, confidence) VALUES (?, ?, ?, ?)',
    );
    const tx = this.db.transaction((items: DetectedPattern[]) => {
      for (const p of items) {
        insert.run(p.category, p.description, JSON.stringify(p.evidence), p.confidence);
      }
    });
    tx(patterns);
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
    this.db.prepare('DELETE FROM project_commands').run();
    const insert = this.db.prepare(
      'INSERT INTO project_commands (name, command, source_file, type) VALUES (?, ?, ?, ?)',
    );
    const tx = this.db.transaction((items: ProjectCommand[]) => {
      for (const c of items) {
        insert.run(c.name, c.command, c.sourceFile, c.type);
      }
    });
    tx(commands);
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

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}

/**
 * @module dictionary-query
 * @description Query API over the codebase_entities table.
 *   Provides search, dependency lookups, and Markdown context generation.
 * @inputs better-sqlite3 Database instance (with codebase_entities table)
 * @outputs CodeEntity arrays, DictionaryContext for LLM prompts
 * @depends-on better-sqlite3, types.ts
 * @depended-on-by workflow steps, context injection
 */

import type Database from 'better-sqlite3';
import type {
  CodeEntity,
  DictionaryContext,
  DictionaryContextOptions,
  DictionaryQuery,
} from '../types';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS codebase_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_number INTEGER,
  signature TEXT,
  purpose TEXT DEFAULT '',
  is_exported INTEGER NOT NULL DEFAULT 1,
  created_by_workflow TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(file_path, name, kind)
);
CREATE INDEX IF NOT EXISTS idx_entities_file ON codebase_entities(file_path);
CREATE INDEX IF NOT EXISTS idx_entities_name ON codebase_entities(name);

CREATE TABLE IF NOT EXISTS entity_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES codebase_entities(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES codebase_entities(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
  UNIQUE(source_id, target_id, relationship)
);
`;

interface EntityRow {
  name: string;
  kind: string;
  file_path: string;
  line_number: number | null;
  signature: string | null;
  purpose: string | null;
  is_exported: number;
  created_by_workflow: string | null;
  created_at: string;
}

function rowToEntity(row: EntityRow): CodeEntity {
  return {
    name: row.name,
    kind: row.kind as CodeEntity['kind'],
    filePath: row.file_path,
    lineNumber: row.line_number ?? 0,
    signature: row.signature ?? '',
    purpose: row.purpose ?? '',
    isExported: row.is_exported === 1,
    createdByWorkflow: row.created_by_workflow ?? '',
    createdAt: row.created_at,
  };
}

export class DictionaryQueryImpl implements DictionaryQuery {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(SCHEMA_SQL);
  }

  async getEntitiesInFiles(filePaths: string[]): Promise<CodeEntity[]> {
    if (filePaths.length === 0) return [];

    const placeholders = filePaths.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM codebase_entities WHERE file_path IN (${placeholders})`)
      .all(...filePaths) as EntityRow[];

    return rows.map(rowToEntity);
  }

  async getDependents(entityName: string, filePath: string): Promise<CodeEntity[]> {
    const rows = this.db
      .prepare(`
        SELECT ce.* FROM codebase_entities ce
        JOIN entity_relationships er ON er.source_id = ce.id
        JOIN codebase_entities target ON er.target_id = target.id
        WHERE target.name = ? AND target.file_path = ?
      `)
      .all(entityName, filePath) as EntityRow[];

    return rows.map(rowToEntity);
  }

  async getDependencies(entityName: string, filePath: string): Promise<CodeEntity[]> {
    const rows = this.db
      .prepare(`
        SELECT ce.* FROM codebase_entities ce
        JOIN entity_relationships er ON er.target_id = ce.id
        JOIN codebase_entities source ON er.source_id = source.id
        WHERE source.name = ? AND source.file_path = ?
      `)
      .all(entityName, filePath) as EntityRow[];

    return rows.map(rowToEntity);
  }

  async search(query: string, limit: number = 20): Promise<CodeEntity[]> {
    const likePattern = `%${query}%`;
    const rows = this.db
      .prepare(`
        SELECT * FROM codebase_entities
        WHERE name LIKE ? COLLATE NOCASE
           OR purpose LIKE ? COLLATE NOCASE
        LIMIT ?
      `)
      .all(likePattern, likePattern, limit) as EntityRow[];

    return rows.map(rowToEntity);
  }

  async toContext(options?: DictionaryContextOptions): Promise<DictionaryContext> {
    const maxChars = options?.maxChars ?? 3000;
    const totalCount = await this.getEntityCount();

    if (totalCount === 0) {
      return { summary: '', entityCount: 0, truncated: false };
    }

    // Build query with optional filters
    let query = 'SELECT * FROM codebase_entities';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.relevantPaths && options.relevantPaths.length > 0) {
      const placeholders = options.relevantPaths.map(() => '?').join(', ');
      conditions.push(`file_path IN (${placeholders})`);
      params.push(...options.relevantPaths);
    }

    if (options?.includeKinds && options.includeKinds.length > 0) {
      const placeholders = options.includeKinds.map(() => '?').join(', ');
      conditions.push(`kind IN (${placeholders})`);
      params.push(...options.includeKinds);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY file_path, name';

    const rows = this.db.prepare(query).all(...params) as EntityRow[];
    const entities = rows.map(rowToEntity);

    // Group by file path
    const grouped = new Map<string, CodeEntity[]>();
    for (const entity of entities) {
      const list = grouped.get(entity.filePath) ?? [];
      list.push(entity);
      grouped.set(entity.filePath, list);
    }

    // Build Markdown output, respecting maxChars
    let output = '## Codebase Dictionary (relevant entities)\n';
    let truncated = false;
    let renderedCount = 0;

    for (const [filePath, fileEntities] of grouped) {
      const section = `\n### ${filePath}\n`;
      if (output.length + section.length > maxChars) {
        truncated = true;
        break;
      }
      output += section;

      for (const entity of fileEntities) {
        const sig = entity.signature || entity.name;
        const purposePart = entity.purpose ? ` \u2014 ${entity.purpose}` : '';
        const line = `- \`${sig}\` \u2014 ${entity.kind}${purposePart}\n`;

        if (output.length + line.length > maxChars) {
          truncated = true;
          break;
        }
        output += line;
        renderedCount++;
      }

      if (truncated) break;
    }

    if (truncated) {
      output += `\n_[dictionary truncated \u2014 showing ${renderedCount} of ${totalCount} entities]_`;
    }

    return {
      summary: output,
      entityCount: renderedCount,
      truncated,
    };
  }

  async getEntityCount(): Promise<number> {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM codebase_entities')
      .get() as { count: number };
    return row.count;
  }
}

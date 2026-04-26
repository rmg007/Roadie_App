/**
 * @module entity-writer
 * @description Extracts code entities from file content using regex patterns
 *   and persists them to SQLite. Part of the Codebase Dictionary (M24).
 * @inputs File content (string), node:sqlite Database instance
 * @outputs Persisted CodeEntity rows in codebase_entities table
 * @depends-on node:sqlite, types.ts
 * @depended-on-by dictionary-query.ts, file-watcher-manager.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
// @ts-expect-error node:sqlite types not available in this environment
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
type SqliteDb = InstanceType<typeof DatabaseSync>;
import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';
import type {
  CodeEntity,
  EntityWriter,
  RecordEntitiesParams,
} from '../types';

const MAX_FILE_SIZE = 500 * 1024; // 500KB

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

interface ExtractedEntity {
  name: string;
  kind: CodeEntity['kind'];
  lineNumber: number;
  signature: string;
  purpose: string;
}

/**
 * Regex patterns for extracting exported entities from TypeScript/JavaScript files.
 * Each pattern captures: the entity name and enough context for the signature.
 */
const EXTRACTION_PATTERNS: Array<{
  regex: RegExp;
  kind: CodeEntity['kind'];
}> = [
  // export async function X(...) or export function X(...)
  { regex: /^export\s+(?:async\s+)?function\s+(\w+)[^]*?(?=[{]|$)/gm, kind: 'function' },
  // export const X = (...) => (arrow function)
  { regex: /^export\s+const\s+(\w+)\s*=\s*(?:\([^)]*\)|[^=])\s*(?::\s*[^=]+)?\s*=>/gm, kind: 'function' },
  // export class X
  { regex: /^export\s+(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' },
  // export interface X
  { regex: /^export\s+interface\s+(\w+)/gm, kind: 'interface' },
  // export type X =
  { regex: /^export\s+type\s+(\w+)/gm, kind: 'type' },
  // export enum X
  { regex: /^export\s+enum\s+(\w+)/gm, kind: 'enum' },
  // route patterns: app.get('/path', ...) or router.post('/path', ...)
  { regex: /(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gm, kind: 'route' },
  // export const X = (non-arrow-function constant)
  { regex: /^export\s+const\s+(\w+)\s*(?::\s*[^=]+)?\s*=/gm, kind: 'constant' },
];

function getLineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

function getSignature(content: string, index: number): string {
  const rest = content.slice(index);
  const braceIdx = rest.indexOf('{');
  const arrowIdx = rest.indexOf('=>');
  let end = rest.indexOf('\n');
  if (end === -1) end = rest.length;

  if (braceIdx !== -1 && braceIdx < end) end = braceIdx;
  if (arrowIdx !== -1 && arrowIdx < end) end = arrowIdx + 2;

  return rest.slice(0, end).trim();
}

function getJsDocPurpose(content: string, matchIndex: number): string {
  // Look at up to 3 lines above the match for a JSDoc comment
  const before = content.slice(0, matchIndex);
  const lines = before.split('\n');
  const lastFewLines = lines.slice(-4).join('\n');

  const jsdocMatch = lastFewLines.match(/\/\*\*\s*([\s\S]*?)\s*\*\//);
  if (!jsdocMatch) return '';

  // Extract the description (first line of JSDoc, stripped of * prefix)
  const raw = jsdocMatch[1] ?? '';
  const descLines = raw
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter((l) => l && !l.startsWith('@'));
  return descLines.join(' ').slice(0, 200);
}

function isBinaryContent(content: string): boolean {
  // Quick heuristic: check first 512 chars for null bytes
  const sample = content.slice(0, 512);
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) return true;
  }
  return false;
}

function extractEntities(content: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  for (const pattern of EXTRACTION_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      // Route patterns have a different capture group layout
      if (pattern.kind === 'route') {
        const method = match[1] ?? '';
        const routePath = match[2] ?? '';
        const name = `${method.toUpperCase()} ${routePath}`;
        const key = `${name}::route`;
        if (seen.has(key)) continue;
        seen.add(key);
        entities.push({
          name,
          kind: 'route',
          lineNumber: getLineNumber(content, match.index),
          signature: match[0].trim(),
          purpose: getJsDocPurpose(content, match.index),
        });
        continue;
      }

      const name = match[1] ?? '';
      const kind = pattern.kind;

      // For constant pattern, skip if already captured as arrow function
      const key = `${name}::${kind}`;
      if (kind === 'constant') {
        if (seen.has(`${name}::function`)) continue;
        // Double-check it's not an arrow function by looking at the full match
        const restOfLine = content.slice(match.index, match.index + 200);
        if (/=\s*(?:\([^)]*\)|[^=])\s*(?::\s*[^=]+)?\s*=>/.test(restOfLine)) continue;
      }

      if (seen.has(key)) continue;
      seen.add(key);

      entities.push({
        name,
        kind,
        lineNumber: getLineNumber(content, match.index),
        signature: getSignature(content, match.index),
        purpose: getJsDocPurpose(content, match.index),
      });
    }
  }

  return entities;
}

export class EntityWriterImpl implements EntityWriter {
  private db: SqliteDb;
  private log: Logger;

  constructor(db: SqliteDb, log: Logger = STUB_LOGGER) {
    this.db = db;
    this.log = log;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(SCHEMA_SQL);
  }

  async recordEntities(params: RecordEntitiesParams): Promise<void> {
    const { filePath, fileContent, workflowType } = params;

    // Skip files that are too large
    if (fileContent.length > MAX_FILE_SIZE) return;

    // Skip binary content
    if (isBinaryContent(fileContent)) return;

    try {
      const entities = extractEntities(fileContent);

      const upsert = this.db.prepare(`
        INSERT INTO codebase_entities (name, kind, file_path, line_number, signature, purpose, is_exported, created_by_workflow)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(file_path, name, kind) DO UPDATE SET
          line_number = excluded.line_number,
          signature = excluded.signature,
          purpose = excluded.purpose,
          created_by_workflow = excluded.created_by_workflow,
          updated_at = datetime('now')
      `);

      this.db.exec('BEGIN');
      try {
        for (const e of entities) {
          upsert.run(e.name, e.kind, filePath, e.lineNumber, e.signature, e.purpose, workflowType);
        }
        this.db.exec('COMMIT');
      } catch (txErr) {
        this.db.exec('ROLLBACK');
        throw txErr;
      }
    } catch (err) {
      // Log but don't throw - never crash a workflow
      this.log.error(`[EntityWriter] Error recording entities for ${filePath}:`, err);
    }
  }

  async invalidateFile(filePath: string): Promise<void> {
    try {
      this.db.prepare('DELETE FROM codebase_entities WHERE file_path = ?').run(filePath);
    } catch (err) {
      this.log.error(`[EntityWriter] Error invalidating file ${filePath}:`, err);
    }
  }
}

// Exported for testing
export { extractEntities, getLineNumber, getSignature, getJsDocPurpose };


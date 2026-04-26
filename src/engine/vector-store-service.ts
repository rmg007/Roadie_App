import * as lancedb from '@lancedb/lancedb';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';

/* eslint-disable no-restricted-syntax -- Local vector index bootstrap and manifest metadata reads are intentionally synchronous. */

export interface VectorChunk {
  id: string;
  vector: number[];
  text: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

type IndexFileResult =
  | { indexed: false; reason: 'unchanged' | 'empty'; chunks: 0 }
  | { indexed: true; reason: 'updated'; chunks: number };

export class VectorStoreService {
  private db: lancedb.Connection | null = null;
  private readonly dbPath: string;
  private readonly manifestPath: string;
  private readonly tableName = 'code_vectors';

  constructor(projectRoot: string) {
    this.dbPath = path.join(projectRoot, '.roadie', 'vectors.lance');
    this.manifestPath = path.join(projectRoot, '.roadie', 'vector-index-manifest.json');
    if (!fs.existsSync(path.dirname(this.dbPath))) {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }
  }

  private async ensureDb(): Promise<lancedb.Connection> {
    if (!this.db) {
      this.db = await lancedb.connect(this.dbPath);
    }
    return this.db;
  }

  /**
   * Simple "Semantic Hash" vector generator for environments without OpenAI keys.
   * This is a placeholder that maps text into a 1536-dim space using hashing.
   * Real production use would use a proper embedding model.
   */
  private generatePlaceholderVector(text: string): number[] {
    const hash = createHash('sha256').update(text).digest();
    const vector = new Array(1536).fill(0);
    for (let i = 0; i < hash.length; i++) {
      vector[i % 1536] = (hash[i] ?? 0) / 255;
    }
    return vector;
  }

  private hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private readManifest(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private writeManifest(manifest: Record<string, string>): void {
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  private toTableRows(chunks: VectorChunk[]): Record<string, unknown>[] {
    return chunks.map((chunk) => ({ ...chunk }));
  }

  private async getOrCreateTable(db: lancedb.Connection, chunks: VectorChunk[]): Promise<lancedb.Table> {
    const tableNames = await db.tableNames();
    if (!tableNames.includes(this.tableName)) {
      return db.createTable(this.tableName, this.toTableRows(chunks));
    }
    return db.openTable(this.tableName);
  }

  async indexFile(filePath: string, content: string): Promise<IndexFileResult> {
    const db = await this.ensureDb();
    const manifest = this.readManifest();
    const fileHash = this.hashText(content);
    if (manifest[filePath] === fileHash) {
      return { indexed: false, reason: 'unchanged' as const, chunks: 0 };
    }

    const chunks: VectorChunk[] = [];
    
    // Simple line-based chunking (50 lines per chunk, 10 line overlap)
    const lines = content.split('\n');
    const chunkSize = 50;
    const overlap = 10;

    for (let i = 0; i < lines.length; i += (chunkSize - overlap)) {
      const chunkLines = lines.slice(i, i + chunkSize);
      const text = chunkLines.join('\n');
      if (text.trim().length === 0) continue;

      chunks.push({
        id: `${filePath}:${i}`,
        vector: this.generatePlaceholderVector(text),
        text,
        filePath,
        startLine: i + 1,
        endLine: i + chunkLines.length
      });

      if (i + chunkSize >= lines.length) break;
    }

    if (chunks.length === 0) {
      manifest[filePath] = fileHash;
      this.writeManifest(manifest);
      return { indexed: false, reason: 'empty' as const, chunks: 0 };
    }

    const table = await this.getOrCreateTable(db, chunks);
    const escapedFilePath = filePath.replace(/'/g, "''");
    await table.delete(`filePath = '${escapedFilePath}'`);
    await table.add(this.toTableRows(chunks));

    manifest[filePath] = fileHash;
    this.writeManifest(manifest);

    return { indexed: true, reason: 'updated' as const, chunks: chunks.length };
  }

  async search(query: string, limit = 5): Promise<Omit<VectorChunk, 'vector'>[]> {
    const db = await this.ensureDb();
    const tableNames = await db.tableNames();
    if (!tableNames.includes(this.tableName)) return [];

    const table = await db.openTable(this.tableName);
    const queryVector = this.generatePlaceholderVector(query);
    
    const results = await table
      .vectorSearch(queryVector)
      .limit(limit)
      .toArray();

    return results.map(r => ({
      id: r.id as string,
      text: r.text as string,
      filePath: r.filePath as string,
      startLine: r.startLine as number,
      endLine: r.endLine as number
    }));
  }
}

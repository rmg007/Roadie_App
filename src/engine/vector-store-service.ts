import * as lancedb from '@lancedb/lancedb';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';

export interface VectorChunk {
  id: string;
  vector: number[];
  text: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

export class VectorStoreService {
  private db: lancedb.Connection | null = null;
  private readonly dbPath: string;
  private readonly tableName = 'code_vectors';

  constructor(projectRoot: string) {
    this.dbPath = path.join(projectRoot, '.github', '.roadie', 'vectors.lance');
    if (!fs.existsSync(path.dirname(this.dbPath))) {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }
  }

  private async ensureDb() {
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
      vector[i % 1536] = hash[i] / 255;
    }
    return vector;
  }

  async indexFile(filePath: string, content: string) {
    const db = await this.ensureDb();
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

    const tableNames = await db.tableNames();
    if (!tableNames.includes(this.tableName)) {
      await db.createTable(this.tableName, chunks);
    } else {
      const table = await db.openTable(this.tableName);
      // For now, we just add. In a real system, we'd delete old records for this file first.
      await table.add(chunks);
    }
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

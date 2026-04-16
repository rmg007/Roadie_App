import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
import { DictionaryQueryImpl } from './dictionary-query';
import { EntityWriterImpl } from './entity-writer';
import type { RecordEntitiesParams } from '../types';

function createTestDb(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function makeParams(overrides: Partial<RecordEntitiesParams> = {}): RecordEntitiesParams {
  return {
    filePath: 'src/example.ts',
    fileContent: '',
    workflowType: 'feature',
    stepId: 'step-1',
    originalPrompt: 'test prompt',
    ...overrides,
  };
}

describe('DictionaryQueryImpl', () => {
  let db: InstanceType<typeof DatabaseSync>;
  let query: DictionaryQueryImpl;
  let writer: EntityWriterImpl;

  beforeEach(() => {
    db = createTestDb();
    writer = new EntityWriterImpl(db);
    query = new DictionaryQueryImpl(db);
  });

  afterEach(() => {
    db.close();
  });

  // Helpers to seed test data
  async function seedEntities(): Promise<void> {
    await writer.recordEntities(makeParams({
      filePath: 'src/auth/login.ts',
      fileContent: `
/** Validates a JWT token */
export function validateToken(token: string): boolean {
  return true;
}

/** Handles user login */
export class LoginHandler {
  handle() {}
}
`,
    }));

    await writer.recordEntities(makeParams({
      filePath: 'src/auth/session.ts',
      fileContent: `
/** Creates a new session */
export function createSession(userId: string): Session {
  return {} as Session;
}

export interface SessionConfig {
  ttl: number;
}
`,
    }));

    await writer.recordEntities(makeParams({
      filePath: 'src/api/routes.ts',
      fileContent: `
export function handleRequest(req: Request): Response {
  return new Response();
}

export const MAX_REQUESTS = 100;
`,
    }));
  }

  it('returns empty array for files with no entities', async () => {
    const result = await query.getEntitiesInFiles(['src/nonexistent.ts']);
    expect(result).toEqual([]);
  });

  it('getEntitiesInFiles returns only entities in specified files', async () => {
    await seedEntities();

    const result = await query.getEntitiesInFiles(['src/auth/login.ts']);
    expect(result).toHaveLength(2);
    const names = result.map((e) => e.name);
    expect(names).toContain('validateToken');
    expect(names).toContain('LoginHandler');

    // Should not include entities from other files
    expect(names).not.toContain('createSession');
  });

  it('getEntitiesInFiles handles multiple files', async () => {
    await seedEntities();

    const result = await query.getEntitiesInFiles([
      'src/auth/login.ts',
      'src/auth/session.ts',
    ]);
    expect(result.length).toBeGreaterThanOrEqual(4);
  });

  it('search matches entity names case-insensitively', async () => {
    await seedEntities();

    const result = await query.search('VALIDATE');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBe('validateToken');
  });

  it('search matches entity purposes', async () => {
    await seedEntities();

    const result = await query.search('JWT');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBe('validateToken');
  });

  it('search respects limit', async () => {
    await seedEntities();

    const result = await query.search('e', 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('toContext returns empty string when no entities', async () => {
    const result = await query.toContext();
    expect(result.summary).toBe('');
    expect(result.entityCount).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('toContext groups entities by file path', async () => {
    await seedEntities();

    const result = await query.toContext({ maxChars: 5000 });
    expect(result.summary).toContain('## Codebase Dictionary (relevant entities)');
    expect(result.summary).toContain('### src/auth/login.ts');
    expect(result.summary).toContain('### src/auth/session.ts');
    expect(result.summary).toContain('### src/api/routes.ts');
    expect(result.entityCount).toBeGreaterThan(0);
  });

  it('toContext respects maxChars and sets truncated=true', async () => {
    await seedEntities();

    // Use a very small maxChars to force truncation
    const result = await query.toContext({ maxChars: 200 });
    expect(result.truncated).toBe(true);
    expect(result.summary).toContain('dictionary truncated');
    expect(result.summary.length).toBeLessThanOrEqual(300); // some slack for the truncation message
  });

  it('toContext filters by relevantPaths', async () => {
    await seedEntities();

    const result = await query.toContext({
      relevantPaths: ['src/auth/login.ts'],
      maxChars: 5000,
    });
    expect(result.summary).toContain('src/auth/login.ts');
    expect(result.summary).not.toContain('src/api/routes.ts');
  });

  it('toContext filters by includeKinds', async () => {
    await seedEntities();

    const result = await query.toContext({
      includeKinds: ['class'],
      maxChars: 5000,
    });
    expect(result.summary).toContain('LoginHandler');
    expect(result.summary).not.toContain('MAX_REQUESTS');
  });

  it('getEntityCount returns correct count', async () => {
    expect(await query.getEntityCount()).toBe(0);

    await seedEntities();

    const count = await query.getEntityCount();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  it('getEntitiesInFiles returns empty for empty input', async () => {
    const result = await query.getEntitiesInFiles([]);
    expect(result).toEqual([]);
  });
});

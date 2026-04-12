import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { EntityWriterImpl } from './entity-writer';
import type { RecordEntitiesParams } from '../types';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
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

describe('EntityWriterImpl', () => {
  let db: Database.Database;
  let writer: EntityWriterImpl;

  beforeEach(() => {
    db = createTestDb();
    writer = new EntityWriterImpl(db);
  });

  afterEach(() => {
    db.close();
  });

  it('extracts exported functions from TypeScript file', async () => {
    const content = `
export function validateToken(token: string): boolean {
  return token.length > 0;
}

export async function fetchUser(id: number): Promise<User> {
  return db.get(id);
}
`;
    await writer.recordEntities(makeParams({ fileContent: content }));

    const rows = db.prepare('SELECT * FROM codebase_entities ORDER BY name').all() as Array<{ name: string; kind: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('fetchUser');
    expect(rows[0].kind).toBe('function');
    expect(rows[1].name).toBe('validateToken');
    expect(rows[1].kind).toBe('function');
  });

  it('extracts exported classes with correct line numbers', async () => {
    const content = `import { Base } from './base';

/** Handler for user login requests. */
export class LoginHandler extends Base {
  handle() {}
}

export class UserService {
  getUser() {}
}
`;
    await writer.recordEntities(makeParams({ fileContent: content }));

    const rows = db.prepare('SELECT * FROM codebase_entities ORDER BY line_number').all() as Array<{
      name: string; kind: string; line_number: number; purpose: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('LoginHandler');
    expect(rows[0].kind).toBe('class');
    expect(rows[0].line_number).toBe(4);
    expect(rows[0].purpose).toContain('Handler for user login');
    expect(rows[1].name).toBe('UserService');
    expect(rows[1].kind).toBe('class');
    expect(rows[1].line_number).toBe(8);
  });

  it('extracts exported interfaces and types', async () => {
    const content = `
export interface UserConfig {
  name: string;
  email: string;
}

export type UserId = string | number;
`;
    await writer.recordEntities(makeParams({ fileContent: content }));

    const rows = db.prepare('SELECT * FROM codebase_entities ORDER BY name').all() as Array<{ name: string; kind: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('UserConfig');
    expect(rows[0].kind).toBe('interface');
    expect(rows[1].name).toBe('UserId');
    expect(rows[1].kind).toBe('type');
  });

  it('extracts arrow function exports', async () => {
    const content = `
export const greet = (name: string) => {
  return \`Hello, \${name}\`;
};

export const add = (a: number, b: number): number => a + b;
`;
    await writer.recordEntities(makeParams({ fileContent: content }));

    const rows = db.prepare('SELECT * FROM codebase_entities WHERE kind = ?').all('function') as Array<{ name: string; kind: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const names = rows.map((r) => r.name);
    expect(names).toContain('greet');
  });

  it('does not extract non-exported functions', async () => {
    const content = `
function privateHelper() {
  return 42;
}

const localConst = 'hello';

class InternalClass {}

export function publicApi(): void {}
`;
    await writer.recordEntities(makeParams({ fileContent: content }));

    const rows = db.prepare('SELECT * FROM codebase_entities').all() as Array<{ name: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('publicApi');
  });

  it('handles files with no exports', async () => {
    const content = `
const x = 1;
function foo() {}
class Bar {}
`;
    await writer.recordEntities(makeParams({ fileContent: content }));

    const rows = db.prepare('SELECT * FROM codebase_entities').all();
    expect(rows).toHaveLength(0);
  });

  it('handles files >500KB without throwing', async () => {
    const content = 'x'.repeat(600 * 1024);
    await expect(
      writer.recordEntities(makeParams({ fileContent: content })),
    ).resolves.not.toThrow();

    const rows = db.prepare('SELECT * FROM codebase_entities').all();
    expect(rows).toHaveLength(0);
  });

  it('upserts on duplicate file_path+name+kind', async () => {
    const content1 = `
/** Old purpose */
export function validate(input: string): boolean {
  return true;
}
`;
    const content2 = `
/** New purpose */
export function validate(input: string, strict: boolean): boolean {
  return strict ? input.length > 0 : true;
}
`;
    await writer.recordEntities(makeParams({ fileContent: content1 }));
    await writer.recordEntities(makeParams({ fileContent: content2 }));

    const rows = db.prepare('SELECT * FROM codebase_entities').all() as Array<{
      name: string; purpose: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('validate');
    expect(rows[0].purpose).toContain('New purpose');
  });

  it('invalidateFile removes all entities for that file', async () => {
    const content = `
export function a() {}
export function b() {}
export class C {}
`;
    await writer.recordEntities(makeParams({
      filePath: 'src/target.ts',
      fileContent: content,
    }));
    await writer.recordEntities(makeParams({
      filePath: 'src/other.ts',
      fileContent: 'export function keep() {}',
    }));

    let count = (db.prepare('SELECT COUNT(*) as c FROM codebase_entities').get() as { c: number }).c;
    expect(count).toBeGreaterThanOrEqual(4);

    await writer.invalidateFile('src/target.ts');

    count = (db.prepare('SELECT COUNT(*) as c FROM codebase_entities').get() as { c: number }).c;
    expect(count).toBe(1);

    const remaining = db.prepare('SELECT name FROM codebase_entities').all() as Array<{ name: string }>;
    expect(remaining[0].name).toBe('keep');
  });

  it('extracts enum exports', async () => {
    const content = `
export enum Color {
  Red = 'RED',
  Blue = 'BLUE',
}
`;
    await writer.recordEntities(makeParams({ fileContent: content }));

    const rows = db.prepare('SELECT * FROM codebase_entities').all() as Array<{ name: string; kind: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Color');
    expect(rows[0].kind).toBe('enum');
  });

  it('extracts route patterns', async () => {
    const content = `
app.get('/api/users', handler);
router.post('/api/login', loginHandler);
`;
    await writer.recordEntities(makeParams({ fileContent: content }));

    const rows = db.prepare('SELECT * FROM codebase_entities WHERE kind = ?').all('route') as Array<{ name: string }>;
    expect(rows).toHaveLength(2);
    const names = rows.map((r) => r.name);
    expect(names).toContain('GET /api/users');
    expect(names).toContain('POST /api/login');
  });

  it('extracts constant exports', async () => {
    const content = `
export const MAX_RETRIES = 3;
export const DEFAULT_TIMEOUT = 5000;
`;
    await writer.recordEntities(makeParams({ fileContent: content }));

    const rows = db.prepare('SELECT * FROM codebase_entities WHERE kind = ?').all('constant') as Array<{ name: string }>;
    expect(rows).toHaveLength(2);
    const names = rows.map((r) => r.name);
    expect(names).toContain('MAX_RETRIES');
    expect(names).toContain('DEFAULT_TIMEOUT');
  });
});

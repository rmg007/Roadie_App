import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const deleteMock = vi.fn();
const addMock = vi.fn();
const openTableMock = vi.fn();
const createTableMock = vi.fn();
const tableNamesMock = vi.fn();
const connectMock = vi.fn();

vi.mock('@lancedb/lancedb', () => ({
  connect: connectMock,
}));

describe('VectorStoreService', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-vector-test-'));
    deleteMock.mockReset();
    addMock.mockReset();
    openTableMock.mockReset();
    createTableMock.mockReset();
    tableNamesMock.mockReset();
    connectMock.mockReset();

    const table = {
      delete: deleteMock,
      add: addMock,
    };
    tableNamesMock.mockResolvedValue(['code_vectors']);
    openTableMock.mockResolvedValue(table);
    createTableMock.mockResolvedValue(table);
    deleteMock.mockResolvedValue(undefined);
    addMock.mockResolvedValue(undefined);
    connectMock.mockResolvedValue({
      tableNames: tableNamesMock,
      openTable: openTableMock,
      createTable: createTableMock,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('skips reindex for unchanged content', async () => {
    const { VectorStoreService } = await import('./vector-store-service');
    const service = new VectorStoreService(tmpDir);

    const first = await service.indexFile('src/index.ts', 'const x = 1;');
    const second = await service.indexFile('src/index.ts', 'const x = 1;');

    expect(first.indexed).toBe(true);
    expect(second).toEqual({ indexed: false, reason: 'unchanged', chunks: 0 });
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it('deletes prior rows before reindexing changed content', async () => {
    const { VectorStoreService } = await import('./vector-store-service');
    const service = new VectorStoreService(tmpDir);

    await service.indexFile('src/index.ts', 'const x = 1;');
    await service.indexFile('src/index.ts', 'const x = 2;');

    expect(deleteMock).toHaveBeenCalledWith("filePath = 'src/index.ts'");
    expect(addMock).toHaveBeenCalledTimes(2);
  });
});
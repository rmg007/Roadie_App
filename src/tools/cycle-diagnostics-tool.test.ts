import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getAuditLog } from '../observability/audit-log';
import { handleCycleDiagnostics } from './cycle-diagnostics-tool';

describe('handleCycleDiagnostics', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-cycle-tool-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('aggregates recent cycle events into summaries', () => {
    const audit = getAuditLog(tmpDir);
    audit.append({ type: 'cycle_started', cycleId: 'cycle-1' });
    audit.append({ type: 'checkpoint_created', cycleId: 'cycle-1', message: 'roadie/checkpoint-1' });
    audit.append({ type: 'indexing_file_indexed', cycleId: 'cycle-1', filePath: 'src/index.ts' });
    audit.append({ type: 'cycle_completed', cycleId: 'cycle-1' });

    const result = handleCycleDiagnostics({ limit: 5, maxAgeHours: 24, includeRawEvents: false }, tmpDir, {
      status: 'completed',
      startTime: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      currentPhase: 'Completed',
      filesProcessed: ['src/index.ts'],
    });

    expect(result.cycleCount).toBe(1);
    expect(result.cycles[0].checkpoint.status).toBe('created');
    expect(result.cycles[0].indexing.indexed).toBe(1);
  });
});

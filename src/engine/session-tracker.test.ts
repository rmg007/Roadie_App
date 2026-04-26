import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionTracker } from './session-tracker';

describe('SessionTracker', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-session-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('sanitizes malformed filesProcessed on load', async () => {
    const roadieDir = path.join(tmpDir, '.roadie');
    await fs.mkdir(roadieDir, { recursive: true });
    await fs.writeFile(path.join(roadieDir, 'session-state.json'), JSON.stringify({
      status: 'completed',
      startTime: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      currentPhase: 'Indexing',
      filesProcessed: [null, 'src/index.ts', 7],
    }), 'utf8');

    const tracker = new SessionTracker(tmpDir);
    expect(tracker.getState().filesProcessed).toEqual(['src/index.ts']);
  });

  it('normalizes terminal phase on finishSession', async () => {
    const tracker = new SessionTracker(tmpDir);
    await tracker.updateState({ currentPhase: 'Indexing', filesProcessed: ['src/index.ts'] });
    await tracker.finishSession('completed');

    expect(tracker.getState().status).toBe('completed');
    expect(tracker.getState().currentPhase).toBe('Completed');
    expect(tracker.getState().filesProcessed).toEqual(['src/index.ts']);
  });
});
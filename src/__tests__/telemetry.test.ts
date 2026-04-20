/**
 * Tests for Telemetry — opt-in local telemetry module.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { Telemetry } from '../observability/telemetry';

// Stub getConfig to control telemetry.enabled
vi.mock('../config-loader', () => ({
  getConfig: vi.fn(() => ({ telemetry: { enabled: true } })),
}));

describe('Telemetry', () => {
  let tmpDir: string;
  let telemetry: Telemetry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-telemetry-test-'));
    telemetry = new Telemetry(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('records an event and reads it back', async () => {
    await telemetry.recordEvent({ type: 'workflow_completed', workflowId: 'bug_fix' });
    const events = await telemetry.readToday();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const ev = events.find((e) => e.type === 'workflow_completed');
    expect(ev).toBeDefined();
    expect(ev?.workflowId).toBe('bug_fix');
  });

  it('auto-sets timestamp if not provided', async () => {
    await telemetry.recordEvent({ type: 'intent_classified' });
    const events = await telemetry.readToday();
    const ev = events.find((e) => e.type === 'intent_classified');
    expect(ev?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('readToday returns [] when nothing recorded', async () => {
    const events = await telemetry.readToday();
    expect(events).toEqual([]);
  });

  it('is a no-op when telemetry is disabled', async () => {
    const { getConfig } = await import('../config-loader');
    vi.mocked(getConfig).mockReturnValue({ telemetry: { enabled: false } } as any);

    await telemetry.recordEvent({ type: 'workflow_started' });
    const events = await telemetry.readToday();
    expect(events).toEqual([]);
  });

  it('pruneOlderThan removes old files', async () => {
    const telDir = path.join(tmpDir, '.roadie', 'telemetry');
    await fs.mkdir(telDir, { recursive: true });
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const oldFilePath = path.join(telDir, `${oldDate.toISOString().slice(0, 10)}.jsonl`);
    await fs.writeFile(oldFilePath, '{"type":"old"}\n', 'utf8');
    await fs.utimes(oldFilePath, oldDate, oldDate);

    await telemetry.pruneOlderThan(5);

    let exists = true;
    try { await fs.access(oldFilePath); } catch { exists = false; }
    expect(exists).toBe(false);
  });
});

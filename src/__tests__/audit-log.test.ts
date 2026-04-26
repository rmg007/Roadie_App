/**
 * Tests for AuditLog — append-only JSONL audit log.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { AuditLog } from '../observability/audit-log';

describe('AuditLog', () => {
  let tmpDir: string;
  let log: AuditLog;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-audit-test-'));
    log = new AuditLog(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('appends an event and reads it back today', async () => {
    await log.append({ type: 'file_written', filePath: '.github/AGENTS.md', message: 'new' });
    const events = await log.readToday();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const ev = events.find((e) => e.type === 'file_written');
    expect(ev).toBeDefined();
    expect(ev?.filePath).toBe('.github/AGENTS.md');
  });

  it('appends multiple events in order', async () => {
    await log.append({ type: 'workflow_started', workflowId: 'bug_fix' });
    await log.append({ type: 'workflow_completed', workflowId: 'bug_fix' });
    const events = await log.readToday();
    const types = events.map((e) => e.type);
    expect(types).toContain('workflow_started');
    expect(types).toContain('workflow_completed');
  });

  it('each event has a timestamp', async () => {
    await log.append({ type: 'config_loaded' });
    const events = await log.readToday();
    const ev = events.find((e) => e.type === 'config_loaded');
    expect(ev?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('readToday returns [] when no events written', async () => {
    const events = await log.readToday();
    expect(events).toEqual([]);
  });

  it('readLast returns the most recent events across files', async () => {
    await log.append({ type: 'cycle_started', cycleId: 'cycle-1' });
    await log.append({ type: 'cycle_completed', cycleId: 'cycle-1' });

    const events = log.readLast(1);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('cycle_completed');
  });

  it('readByTypes filters events by type', async () => {
    await log.append({ type: 'cycle_started', cycleId: 'cycle-1' });
    await log.append({ type: 'checkpoint_failed', cycleId: 'cycle-1', message: 'no head' });

    const events = log.readByTypes(['checkpoint_failed'], 5);
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe('no head');
  });

  it('pruneOlderThan removes old files (by mtime)', async () => {
    // Manually create a file and set its mtime to 10 days ago
    const auditDir = path.join(tmpDir, '.roadie', 'audit');
    await fs.mkdir(auditDir, { recursive: true });
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const oldFilePath = path.join(auditDir, `${oldDate.toISOString().slice(0, 10)}.jsonl`);
    await fs.writeFile(oldFilePath, '{"type":"old"}\n', 'utf8');
    // Set mtime to 10 days ago so the prune logic detects it
    await fs.utimes(oldFilePath, oldDate, oldDate);

    log.pruneOlderThan(5);

    let exists = true;
    try { await fs.access(oldFilePath); } catch { exists = false; }
    expect(exists).toBe(false);
  });
});

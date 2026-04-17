/**
 * @test logger-rotation.test.ts (E3)
 * @description Verifies structured log rotation logic:
 *   - rotateLogs() renames roadie.log → roadie.log.1 etc.
 *   - Oldest rotation (roadie.log.3) is deleted when it exists.
 *   - Files shift correctly: .2→.3, .1→.2, current→.1.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { rotateLogs } from '../logger';

describe('rotateLogs()', () => {
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'roadie-rot-test-'));
    logFile = path.join(tmpDir, 'roadie.log');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('renames roadie.log to roadie.log.1', () => {
    fs.writeFileSync(logFile, 'entry1\n', 'utf8');
    rotateLogs(logFile);
    expect(fs.existsSync(path.join(tmpDir, 'roadie.log.1'))).toBe(true);
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('shifts existing rotations correctly', () => {
    // Arrange existing rotations
    fs.writeFileSync(logFile,                          'current\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'roadie.log.1'), 'rotation1\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'roadie.log.2'), 'rotation2\n', 'utf8');

    rotateLogs(logFile);

    expect(fs.readFileSync(path.join(tmpDir, 'roadie.log.1'), 'utf8')).toBe('current\n');
    expect(fs.readFileSync(path.join(tmpDir, 'roadie.log.2'), 'utf8')).toBe('rotation1\n');
    expect(fs.readFileSync(path.join(tmpDir, 'roadie.log.3'), 'utf8')).toBe('rotation2\n');
  });

  it('deletes roadie.log.3 (oldest) when it already exists', () => {
    fs.writeFileSync(logFile,                          'current\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'roadie.log.1'), 'r1\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'roadie.log.2'), 'r2\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'roadie.log.3'), 'r3-old\n', 'utf8');

    rotateLogs(logFile);

    // r3-old should be replaced by r2
    expect(fs.readFileSync(path.join(tmpDir, 'roadie.log.3'), 'utf8')).toBe('r2\n');
  });

  it('is a no-op if roadie.log does not exist', () => {
    expect(() => rotateLogs(logFile)).not.toThrow();
  });

  it('preserves content through rotation chain', () => {
    const content = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    fs.writeFileSync(logFile, content, 'utf8');
    rotateLogs(logFile);
    expect(fs.readFileSync(path.join(tmpDir, 'roadie.log.1'), 'utf8')).toBe(content);
  });
});

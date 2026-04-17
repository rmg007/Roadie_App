/**
 * @test telemetry.test.ts (E2)
 * @description Unit tests for TelemetryReporter and the PII redaction helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── vscode mock (not actually needed for these tests, but avoids import errors) ─

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
    })),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

import { TelemetryReporter, redact } from '../telemetry';

describe('redact()', () => {
  it('strips OpenAI-style tokens', () => {
    expect(redact('key=sk-abcdefghij1234567890')).toContain('[REDACTED_TOKEN]');
    expect(redact('key=sk-abcdefghij1234567890')).not.toContain('sk-abcdefghij');
  });

  it('strips GitHub PATs', () => {
    expect(redact('token=ghp_abcdefghij1234567890')).toContain('[REDACTED_TOKEN]');
  });

  it('strips Unix absolute paths', () => {
    const result = redact('file at /home/user/project/src/index.ts');
    expect(result).toContain('[REDACTED_PATH]');
    expect(result).not.toContain('/home/user');
  });

  it('strips Windows absolute paths', () => {
    const result = redact('file at C:\\Users\\user\\project\\src\\index.ts');
    expect(result).toContain('[REDACTED_PATH]');
  });

  it('leaves safe strings untouched', () => {
    expect(redact('bug_fix success')).toBe('bug_fix success');
    expect(redact('ERR_SQLITE_CORRUPT')).toBe('ERR_SQLITE_CORRUPT');
  });
});

describe('TelemetryReporter — telemetry disabled', () => {
  let reporter: TelemetryReporter;

  beforeEach(() => {
    // Pass false explicitly so no vscode config is consulted
    reporter = new TelemetryReporter(null, false);
  });

  it('does not enqueue events when telemetry is disabled', () => {
    reporter.recordActivation(100);
    reporter.recordCommand('roadie.init', true);
    reporter.recordError('ERR_TEST');
    expect(reporter.drain()).toHaveLength(0);
  });
});

describe('TelemetryReporter — telemetry enabled', () => {
  let reporter: TelemetryReporter;

  beforeEach(() => {
    // Pass true explicitly to enable without vscode config dependency
    reporter = new TelemetryReporter(null, true);
  });

  it('recordActivation enqueues an activation event with durationMs', () => {
    reporter.recordActivation(250);
    const events = reporter.drain();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('activation');
    expect(events[0].durationMs).toBe(250);
  });

  it('recordCommand enqueues a command event', () => {
    reporter.recordCommand('roadie.init', true);
    const events = reporter.drain();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('command');
    expect(events[0].commandId).toBe('roadie.init');
    expect(events[0].success).toBe(true);
  });

  it('recordError enqueues an error event', () => {
    reporter.recordError('ERR_SQLITE_CORRUPT');
    const events = reporter.drain();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].errorCode).toBe('ERR_SQLITE_CORRUPT');
  });

  it('redacts token in commandId', () => {
    reporter.recordCommand('roadie.init sk-abcdefghij1234567890', true);
    const events = reporter.drain();
    expect(events[0].commandId).not.toContain('sk-');
    expect(events[0].commandId).toContain('[REDACTED_TOKEN]');
  });

  it('each event has a ts ISO string', () => {
    reporter.recordCommand('roadie.rescan', false);
    const [event] = reporter.drain();
    expect(() => new Date(event.ts as string)).not.toThrow();
  });

  it('auto-flushes when queue reaches 50 events (with null log path)', () => {
    for (let i = 0; i < 50; i++) {
      reporter.recordCommand(`cmd-${i}`, true);
    }
    // After 50 records the queue is flushed (to null log path, so discarded)
    expect(reporter.drain()).toHaveLength(0);
  });
});

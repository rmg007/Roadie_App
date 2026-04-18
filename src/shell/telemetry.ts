/**
 * @module telemetry
 * @description E2 — In-process telemetry reporter.
 *   Events are queued in memory and flushed to the structured log (no network).
 *   Only active when the `roadie.telemetry` VS Code setting is `true`.
 *   PII redaction strips filesystem paths and tokens matching sk-* / ghp_*.
 *
 * @depends-on node:fs, node:path (for flush path); vscode lazy-required for
 *   config reads so this module stays importable in unit tests without a vscode
 *   runtime.
 * @depended-on-by extension.ts
 */

import { appendFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// PII redaction
// ─────────────────────────────────────────────────────────────────────────────

// Patterns that may carry PII:
//   • sk-…   (OpenAI / Anthropic secret keys)
//   • ghp_…  (GitHub personal access tokens)
//   • Absolute paths (Windows or Unix)
const TOKEN_PATTERN = /\b(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{10,})\b/g;
const PATH_PATTERN  = /([A-Za-z]:[/\\][^\s"',;)]+|\/[^\s"',;)]{4,})/g;

export function redact(input: string): string {
  return input
    .replace(TOKEN_PATTERN, '[REDACTED_TOKEN]')
    .replace(PATH_PATTERN,  '[REDACTED_PATH]');
}

// ─────────────────────────────────────────────────────────────────────────────
// Event types
// ─────────────────────────────────────────────────────────────────────────────

export interface TelemetryEvent {
  type:      'activation' | 'command' | 'error';
  ts:        string;
  durationMs?: number;
  commandId?:  string;
  success?:    boolean;
  errorCode?:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TelemetryReporter class
// ─────────────────────────────────────────────────────────────────────────────

export class TelemetryReporter {
  private readonly queue: TelemetryEvent[] = [];
  private readonly logFilePath: string | null;
  /** Optional override for unit tests. When provided, replaces the vscode config read. */
  private readonly _enabledOverride: boolean | null;

  /**
   * @param logFilePath      Path to the structured log file produced by logger.ts.
   *                         When null the reporter runs silently (telemetry off).
   * @param _enabledOverride When provided (true/false), bypasses the vscode
   *                         settings read. Used only in unit tests.
   */
  constructor(logFilePath: string | null = null, _enabledOverride: boolean | null = null) {
    this.logFilePath    = logFilePath;
    this._enabledOverride = _enabledOverride;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Record extension activation with wall-clock duration. */
  recordActivation(ms: number): void {
    if (!this.isEnabled()) return;
    this.enqueue({ type: 'activation', ts: now(), durationMs: ms });
  }

  /** Record a command invocation. */
  recordCommand(id: string, success: boolean): void {
    if (!this.isEnabled()) return;
    const safeId = redact(id);
    this.enqueue({ type: 'command', ts: now(), commandId: safeId, success });
  }

  /** Record a caught error by its code/name. Never include stack or message. */
  recordError(code: string): void {
    if (!this.isEnabled()) return;
    const safeCode = redact(code);
    this.enqueue({ type: 'error', ts: now(), errorCode: safeCode });
  }

  /** Flush all queued events to the log file and clear the queue. */
  flush(): void {
    if (this.queue.length === 0) return;
    if (!this.logFilePath) {
      this.queue.length = 0;
      return;
    }
    try {
      const lines = this.queue.map(
        (e) => JSON.stringify({ ...e, _telemetry: true }),
      );
      appendFileSync(this.logFilePath, lines.join('\n') + '\n', 'utf8');
    } catch {
      // Best-effort — never throw from telemetry
    } finally {
      this.queue.length = 0;
    }
  }

  /** Drain the in-memory queue without writing (for testing). */
  drain(): TelemetryEvent[] {
    return this.queue.splice(0, this.queue.length);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private isEnabled(): boolean {
    if (this._enabledOverride !== null) return this._enabledOverride;
    try {
      // Lazy-require vscode so this file is safe to import in unit tests.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const vscode = require('vscode') as typeof import('vscode');
      return vscode.workspace
        .getConfiguration('roadie')
        .get<boolean>('telemetry', false);
    } catch {
      return false;
    }
  }

  private enqueue(event: TelemetryEvent): void {
    this.queue.push(event);
    // Auto-flush when queue grows large to cap memory usage.
    if (this.queue.length >= 50) {
      this.flush();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

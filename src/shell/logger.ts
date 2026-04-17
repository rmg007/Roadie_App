/**
 * @module logger
 * @description Central logging utility for the Roadie extension.
 *   Wraps a VS Code OutputChannel ("Roadie") with levelled, timestamped
 *   log methods. Uses a module-level singleton so any module can call
 *   getLogger() without constructor injection.
 *
 *   Before initLogger() is called (e.g. in unit tests) getLogger() returns
 *   a silent no-op logger — no setup required in tests.
 *
 *   E3: Each log entry is also written as a JSON line to
 *   <globalStoragePath>/roadie.log.  When the file exceeds 5 MB it is
 *   rotated: roadie.log → roadie.log.1 → roadie.log.2 → roadie.log.3;
 *   older rotations are deleted.
 *
 * @usage
 *   // extension.ts (once, at activation):
 *   const logger = initLogger(context.globalStorageUri.fsPath);
 *   context.subscriptions.push(logger);
 *
 *   // any other module:
 *   import { getLogger } from '../shell/logger';
 *   getLogger().info('Something happened');
 *
 * @depends-on vscode (OutputChannel API), node:fs
 * @depended-on-by extension.ts, shell/chat-participant.ts,
 *   engine/workflow-engine.ts, engine/step-executor.ts,
 *   spawner/agent-spawner.ts, analyzer/project-analyzer.ts,
 *   generator/file-generator.ts
 */

// NOTE: `vscode` is intentionally NOT imported at module top-level. This
// module is loaded by code paths that also run in the standalone MCP server
// (no vscode runtime). The RoadieLogger class lazy-requires vscode only when
// instantiated — which only happens from extension.ts under VS Code.

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface Logger {
  info(msg: string): void;
  warn(msg: string, err?: unknown): void;
  error(msg: string, err?: unknown): void;
  debug(msg: string): void;
  appendRaw(text: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const LOG_FILE_NAME  = 'roadie.log';
const MAX_LOG_BYTES  = 5 * 1024 * 1024; // 5 MB
const MAX_ROTATIONS  = 3;

// ─────────────────────────────────────────────────────────────────────────────
// No-op implementation (used before initLogger() / in tests)
// ─────────────────────────────────────────────────────────────────────────────

class NullLogger implements Logger {
  info(_msg: string): void {}
  warn(_msg: string, _err?: unknown): void {}
  error(_msg: string, _err?: unknown): void {}
  debug(_msg: string): void {}
  appendRaw(_text: string): void {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Real OutputChannel implementation
// ─────────────────────────────────────────────────────────────────────────────

export class RoadieLogger implements Logger {
  private readonly channel: { appendLine(s: string): void; show(preserveFocus?: boolean): void; dispose(): void };
  private readonly logFilePath: string | null;

  constructor(globalStoragePath?: string) {
    // Lazy require so this file is safe to import outside VS Code.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode');
    this.channel = vscode.window.createOutputChannel('Roadie');

    if (globalStoragePath) {
      try {
        fs.mkdirSync(globalStoragePath, { recursive: true });
        this.logFilePath = path.join(globalStoragePath, LOG_FILE_NAME);
      } catch {
        this.logFilePath = null;
      }
    } else {
      this.logFilePath = null;
    }
  }

  info(msg: string): void {
    this.channel.appendLine(`[INFO]  ${timestamp()} ${msg}`);
    this.writeJsonLine('INFO', msg);
  }

  warn(msg: string, err?: unknown): void {
    this.channel.appendLine(`[WARN]  ${timestamp()} ${msg}`);
    if (err !== undefined) {
      const detail =
        err instanceof Error
          ? `${err.message}${err.stack ? `\n${err.stack}` : ''}`
          : String(err);
      for (const line of detail.split('\n')) {
        this.channel.appendLine(`        ${line}`);
      }
    }
    this.writeJsonLine('WARN', msg, err);
  }

  error(msg: string, err?: unknown): void {
    this.channel.appendLine(`[ERROR] ${timestamp()} ${msg}`);
    if (err !== undefined) {
      const detail =
        err instanceof Error
          ? `${err.message}${err.stack ? `\n${err.stack}` : ''}`
          : String(err);
      // Indent continuation lines so they're visually grouped
      for (const line of detail.split('\n')) {
        this.channel.appendLine(`        ${line}`);
      }
    }
    this.writeJsonLine('ERROR', msg, err);
  }

  debug(msg: string): void {
    this.channel.appendLine(`[DEBUG] ${timestamp()} ${msg}`);
    this.writeJsonLine('DEBUG', msg);
  }

  appendRaw(text: string): void {
    this.channel.appendLine(text);
    this.writeJsonLine('RAW', text);
  }

  /** Reveal the Output panel and switch to the Roadie channel. */
  show(): void {
    this.channel.show(true /* preserveFocus */);
  }

  dispose(): void {
    this.channel.dispose();
  }

  // ── Structured JSON log helpers ──────────────────────────────────────────

  private writeJsonLine(level: string, msg: string, err?: unknown): void {
    if (!this.logFilePath) return;
    try {
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg,
        ...(err !== undefined
          ? {
              err: err instanceof Error
                ? { message: err.message, stack: err.stack }
                : String(err),
            }
          : {}),
      });
      fs.appendFileSync(this.logFilePath, entry + '\n', 'utf8');
      this.maybeRotate();
    } catch {
      // Best-effort: never throw from logger
    }
  }

  private maybeRotate(): void {
    if (!this.logFilePath) return;
    try {
      const stat = fs.statSync(this.logFilePath);
      if (stat.size < MAX_LOG_BYTES) return;
      rotateLogs(this.logFilePath);
    } catch {
      // Best-effort
    }
  }
}

/**
 * Rotate log files:
 *   roadie.log.3 (delete)
 *   roadie.log.2 → roadie.log.3
 *   roadie.log.1 → roadie.log.2
 *   roadie.log   → roadie.log.1
 * (roadie.log is then recreated fresh on next write)
 */
export function rotateLogs(logFilePath: string): void {
  const dir  = path.dirname(logFilePath);
  const base = path.basename(logFilePath);

  // Delete the oldest rotation if it exists
  const oldest = path.join(dir, `${base}.${MAX_ROTATIONS}`);
  try { fs.unlinkSync(oldest); } catch { /* not present */ }

  // Shift rotations down: .2 → .3, .1 → .2
  for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
    const src  = path.join(dir, `${base}.${i}`);
    const dest = path.join(dir, `${base}.${i + 1}`);
    try { fs.renameSync(src, dest); } catch { /* not present */ }
  }

  // Rotate the current log to .1
  try { fs.renameSync(logFilePath, path.join(dir, `${base}.1`)); } catch { /* not present */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton access
// ─────────────────────────────────────────────────────────────────────────────

let _instance: Logger = new NullLogger();

/**
 * Initialise the global logger. Call exactly once from extension.activate().
 * Returns the RoadieLogger so the caller can register it as a disposable.
 *
 * @param globalStoragePath — extension's globalStorageUri.fsPath.
 *   When provided, structured JSON lines are written to
 *   <globalStoragePath>/roadie.log with rotation.
 */
export function initLogger(globalStoragePath?: string): RoadieLogger {
  const logger = new RoadieLogger(globalStoragePath);
  _instance = logger;
  return logger;
}

/**
 * Get the global logger. Safe to call before initLogger() — returns a
 * silent no-op so unit tests need no setup.
 */
export function getLogger(): Logger {
  return _instance;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function timestamp(): string {
  // e.g. "2026-04-14 09:23:45.123"
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

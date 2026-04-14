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
 * @usage
 *   // extension.ts (once, at activation):
 *   const logger = initLogger();
 *   context.subscriptions.push(logger);
 *
 *   // any other module:
 *   import { getLogger } from '../shell/logger';
 *   getLogger().info('Something happened');
 *
 * @depends-on vscode (OutputChannel API)
 * @depended-on-by extension.ts, shell/chat-participant.ts,
 *   engine/workflow-engine.ts, engine/step-executor.ts,
 *   spawner/agent-spawner.ts, analyzer/project-analyzer.ts,
 *   generator/file-generator.ts
 */

// NOTE: `vscode` is intentionally NOT imported at module top-level. This
// module is loaded by code paths that also run in the standalone MCP server
// (no vscode runtime). The RoadieLogger class lazy-requires vscode only when
// instantiated — which only happens from extension.ts under VS Code.

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface Logger {
  info(msg: string): void;
  warn(msg: string, err?: unknown): void;
  error(msg: string, err?: unknown): void;
  debug(msg: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// No-op implementation (used before initLogger() / in tests)
// ─────────────────────────────────────────────────────────────────────────────

class NullLogger implements Logger {
  info(_msg: string): void {}
  warn(_msg: string, _err?: unknown): void {}
  error(_msg: string, _err?: unknown): void {}
  debug(_msg: string): void {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Real OutputChannel implementation
// ─────────────────────────────────────────────────────────────────────────────

export class RoadieLogger implements Logger {
  private readonly channel: { appendLine(s: string): void; show(preserveFocus?: boolean): void; dispose(): void };

  constructor() {
    // Lazy require so this file is safe to import outside VS Code.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode');
    this.channel = vscode.window.createOutputChannel('Roadie');
  }

  info(msg: string): void {
    this.channel.appendLine(`[INFO]  ${timestamp()} ${msg}`);
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
  }

  debug(msg: string): void {
    this.channel.appendLine(`[DEBUG] ${timestamp()} ${msg}`);
  }

  /** Reveal the Output panel and switch to the Roadie channel. */
  show(): void {
    this.channel.show(true /* preserveFocus */);
  }

  dispose(): void {
    this.channel.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton access
// ─────────────────────────────────────────────────────────────────────────────

let _instance: Logger = new NullLogger();

/**
 * Initialise the global logger. Call exactly once from extension.activate().
 * Returns the RoadieLogger so the caller can register it as a disposable.
 */
export function initLogger(): RoadieLogger {
  const logger = new RoadieLogger();
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

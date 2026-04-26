/**
 * @module platform-adapters
 * @description Defines platform-agnostic interfaces for logging, progress,
 *   and cancellation. This allows core logic to remain decoupled from
 *   specific runtime environments (VS Code vs MCP vs CLI).
 */

/** Generic logging levels. */
export interface Logger {
  info(message: string, detail?: unknown): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
  debug(message: string, detail?: unknown): void;
  setLogFile?(filePath: string): void;
}

/** Generic progress reporting for long-running tasks. */
export interface ProgressReporter {
  report(message: string): void;
  reportMarkdown?(markdown: string): void;
}

/** Generic cancellation signal wrapper. */
export interface CancellationHandle {
  readonly isCancelled: boolean;
  onCancelled(callback: () => void): void;
  readonly signal?: AbortSignal;
}

/** Stub implementations for testing or headless environments. */
export const STUB_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export const STUB_PROGRESS: ProgressReporter = {
  report: () => {},
};

export const CONSOLE_LOGGER: Logger = {
  info: (msg) => process.stderr.write(`[INFO] ${msg}\n`),
  warn: (msg, err) => process.stderr.write(`[WARN] ${msg}${err ? ` ${String(err)}` : ''}\n`),
  error: (msg, err) => process.stderr.write(`[ERROR] ${msg}${err ? ` ${String(err)}` : ''}\n`),
  debug: (msg) => process.stderr.write(`[DEBUG] ${msg}\n`),
};

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const formatLog = (level: string, message: string, error?: unknown): string => {
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}] [${level}] ${message}`;
  if (error) {
    line += ` | ${typeof error === 'object' ? JSON.stringify(error) : String(error)}`;
  }
  return line;
};

let logFilePath: string | null = null;

const writeToFile = (line: string): void => {
  if (logFilePath) {
    void fs.appendFile(logFilePath, line + '\n').catch(() => {
      /* Silent */
    });
  }
};

export const MCP_LOGGER: Logger = {
  info: (msg, detail) => {
    const line = formatLog('INFO', msg, detail);
    process.stderr.write(`${line}\n`);
    writeToFile(line);
  },
  warn: (msg, err) => {
    const line = formatLog('WARN', msg, err);
    process.stderr.write(`${line}\n`);
    writeToFile(line);
  },
  error: (msg, err) => {
    const line = formatLog('ERROR', msg, err);
    process.stderr.write(`${line}\n`);
    writeToFile(line);
  },
  debug: (msg, detail) => {
    const line = formatLog('DEBUG', msg, detail);
    process.stderr.write(`${line}\n`);
    writeToFile(line);
  },
  setLogFile: (filePath: string) => {
    void fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {
      /* Silent */
    });
    logFilePath = filePath;
  }
};

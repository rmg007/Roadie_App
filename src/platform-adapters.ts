/**
 * @module platform-adapters
 * @description Defines platform-agnostic interfaces for logging, progress,
 *   and cancellation. This allows core logic to remain decoupled from
 *   specific runtime environments (VS Code vs MCP vs CLI).
 */

/** Generic logging levels. */
export interface Logger {
  info(message: string, detail?: any): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
  debug(message: string, detail?: any): void;
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
  info:  (msg) => console.log(`[INFO] ${msg}`),
  warn:  (msg, err) => console.warn(`[WARN] ${msg}`, err || ''),
  error: (msg, err) => console.error(`[ERROR] ${msg}`, err || ''),
  debug: (msg) => console.debug(`[DEBUG] ${msg}`),
};

import * as fs from 'node:fs';

const formatLog = (level: string, message: string, error?: any) => {
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}] [${level}] ${message}`;
  if (error) {
    line += ` | ${typeof error === 'object' ? JSON.stringify(error) : error}`;
  }
  return line;
};

let logFilePath: string | null = null;

const writeToFile = (line: string) => {
  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, line + '\n');
    } catch { /* Silent */ }
  }
};

export const MCP_LOGGER: Logger = {
  info: (msg, detail) => {
    const line = formatLog('INFO', msg, detail);
    console.error(line);
    writeToFile(line);
  },
  warn: (msg, err) => {
    const line = formatLog('WARN', msg, err);
    console.error(line);
    writeToFile(line);
  },
  error: (msg, err) => {
    const line = formatLog('ERROR', msg, err);
    console.error(line);
    writeToFile(line);
  },
  debug: (msg, detail) => {
    const line = formatLog('DEBUG', msg, detail);
    console.error(line);
    writeToFile(line);
  },
  setLogFile: (path: string) => {
    logFilePath = path;
  }
};

/**
 * @module logger
 * @description Structured JSON logging with file rotation and sensitive field redaction.
 * @inputs Log calls from modules
 * @outputs JSON log lines to stdout and rotating log files
 * @depends-on config-loader, platform-adapters
 * @depended-on-by step-executor, workflow-engine, config-loader
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from './platform-adapters';
import { getConfig } from './config-loader';

/** Log entry structure. */
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Redact sensitive fields from context object.
 * Replaces values for keys matching: password, apiKey, secret, token, key, auth.
 */
function redactSensitiveFields(context?: unknown): Record<string, unknown> | undefined {
  if (!context || typeof context !== 'object') return context as Record<string, unknown>;

  const copy = JSON.parse(JSON.stringify(context));
  const sensitiveKeys = ['password', 'apiKey', 'secret', 'token', 'key', 'auth', 'Authorization'];

  function traverse(obj: Record<string, unknown>): void {
    for (const key in obj) {
      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
        obj[key] = '***REDACTED***';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        traverse(obj[key] as Record<string, unknown>);
      }
    }
  }

  traverse(copy as Record<string, unknown>);
  return copy;
}

/**
 * Structured logger with JSON output and file rotation.
 */
export class StructuredLogger implements Logger {
  private logDir: string;
  private currentFile: string | null = null;
  private currentFileSize: number = 0;
  private maxFileSizeMb: number;
  private maxFileCount: number;
  private level: 'debug' | 'info' | 'warn' | 'error';
  private module: string;

  constructor(module: string, logDir: string = '.roadie/logs') {
    this.module = module;
    this.logDir = logDir;
    const config = getConfig();
    this.level = config.logging?.level ?? 'info';
    this.maxFileSizeMb = config.logging?.fileMaxSizeMb ?? 10;
    this.maxFileCount = config.logging?.fileMaxCount ?? 10;

    // Ensure log directory exists
    void fs.mkdir(this.logDir, { recursive: true })
      .then(() => this.rotate())
      .catch(() => {
        /* Silent */
      });
  }

  /**
   * Rotate log file if it exceeds max size or doesn't exist.
   * Keeps only the last maxFileCount files.
   */
  private async rotate(): Promise<void> {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `roadie-${timestamp}.log`;
    this.currentFile = path.join(this.logDir, filename);

    try {
      try {
        const stats = await fs.stat(this.currentFile);
        this.currentFileSize = stats.size;

        if (this.currentFileSize >= this.maxFileSizeMb * 1024 * 1024) {
          // Rotate to timestamped file
          const backupName = `roadie-${timestamp}-${Date.now()}.log`;
          const backupPath = path.join(this.logDir, backupName);
          await fs.rename(this.currentFile, backupPath);
          this.currentFileSize = 0;
        }
      } catch {
        this.currentFileSize = 0;
      }

      // Cleanup old files (keep only maxFileCount)
      const files = (await fs.readdir(this.logDir))
        .filter((f) => f.startsWith('roadie-') && f.endsWith('.log'))
        .sort()
        .reverse();

      for (let i = this.maxFileCount; i < files.length; i++) {
        try {
          const file = files[i];
          if (!file) continue;
          await fs.unlink(path.join(this.logDir, file));
        } catch {
          /* Silent */
        }
      }
    } catch {
      /* Silent */
    }
  }

  /** Determine if a level should be logged. */
  private shouldLog(level: string): boolean {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return (levels[level as keyof typeof levels] ?? 999) >= (levels[this.level] ?? 999);
  }

  /** Format and write a log entry. */
  private writeLog(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: unknown,
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
      ...(context ? { context: redactSensitiveFields(context) as Record<string, unknown> } : {}),
    };

    const line = JSON.stringify(entry);

    // Write to stdout
    process.stderr.write(`${line}\n`);

    // Write to file
    if (this.currentFile) {
      void fs.appendFile(this.currentFile, line + '\n')
        .then(() => {
          this.currentFileSize += line.length + 1;

          // Check if we need to rotate
          if (this.currentFileSize >= this.maxFileSizeMb * 1024 * 1024) {
            return this.rotate();
          }

          return undefined;
        })
        .catch(() => {
          /* Silent */
        });
    }
  }

  debug(message: string, detail?: unknown): void {
    this.writeLog('debug', message, detail);
  }

  info(message: string, detail?: unknown): void {
    this.writeLog('info', message, detail);
  }

  warn(message: string, error?: unknown): void {
    this.writeLog('warn', message, error);
  }

  error(message: string, error?: unknown): void {
    this.writeLog('error', message, error);
  }

  setLogFile(filePath: string): void {
    // Allow explicit log file path override
    this.currentFile = filePath;
    void fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {
      /* Silent */
    });
  }
}

/**
 * Create a logger instance for a module.
 */
export function createLogger(module: string): Logger {
  return new StructuredLogger(module);
}

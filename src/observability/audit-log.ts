/**
 * @module audit-log
 * @description Append-only JSONL audit log for every Roadie action.
 *   Writes to `.roadie/audit.jsonl`. Rotates daily (new file per calendar day).
 *   Records: intent, steps, file writes, git commits, rollbacks.
 *   Satisfies 6.4: Audit log — append-only JSONL of every action.
 *
 * @outputs AuditLog class with append(event) method
 * @depends-on node:fs, node:path
 * @depended-on-by file-generator, workflow-engine, index.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---- Types ----

export type AuditEventType =
  | 'intent_classified'
  | 'workflow_started'
  | 'workflow_completed'
  | 'workflow_failed'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'file_written'
  | 'file_skipped'
  | 'git_checkpoint'
  | 'git_rollback'
  | 'skill_loaded'
  | 'plugin_loaded'
  | 'config_loaded'
  | 'dry_run_blocked';

export interface AuditEvent {
  timestamp: string;
  type: AuditEventType;
  correlationId?: string;
  workflowId?: string;
  stepId?: string;
  intent?: string;
  filePath?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

// ---- AuditLog ----

/**
 * Append-only JSONL audit logger.
 * Each line is a valid JSON object for easy grep/jq querying.
 * Rotates daily — one file per calendar day under `.roadie/audit/`.
 */
export class AuditLog {
  private logDir: string;
  private enabled: boolean;

  constructor(projectRoot: string, enabled = true) {
    this.logDir = path.join(projectRoot, '.roadie', 'audit');
    this.enabled = enabled;
    if (this.enabled) {
      try {
        fs.mkdirSync(this.logDir, { recursive: true });
      } catch { /* ignore */ }
    }
  }

  /** Append an audit event to today's JSONL file. */
  append(event: Omit<AuditEvent, 'timestamp'>): void {
    if (!this.enabled) return;
    const full: AuditEvent = { ...event, timestamp: new Date().toISOString() };
    const line = JSON.stringify(full) + '\n';
    const filePath = path.join(this.logDir, `${this.todayKey()}.jsonl`);
    try {
      fs.appendFileSync(filePath, line, 'utf-8');
    } catch { /* best-effort; never crash on audit log failure */ }
  }

  /** Prune audit files older than `maxDays` days. */
  pruneOlderThan(maxDays = 30): void {
    if (!this.enabled) return;
    try {
      const files = fs.readdirSync(this.logDir);
      const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const fullPath = path.join(this.logDir, file);
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(fullPath);
      }
    } catch { /* best-effort */ }
  }

  /** Read all events from today's log. Useful for tests. */
  readToday(): AuditEvent[] {
    if (!this.enabled) return [];
    const filePath = path.join(this.logDir, `${this.todayKey()}.jsonl`);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return raw
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as AuditEvent);
    } catch {
      return [];
    }
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  }
}

/** Singleton factory — one per project root. */
const instances = new Map<string, AuditLog>();

export function getAuditLog(projectRoot: string, enabled = true): AuditLog {
  const key = projectRoot;
  if (!instances.has(key)) {
    instances.set(key, new AuditLog(projectRoot, enabled));
  }
  return instances.get(key)!;
}

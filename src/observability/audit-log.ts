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

/* eslint-disable no-restricted-syntax -- Audit logging is intentionally synchronous to preserve event order and durability semantics. */

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
  | 'dry_run_blocked'
  | 'cycle_started'
  | 'cycle_phase_changed'
  | 'cycle_completed'
  | 'cycle_failed'
  | 'checkpoint_started'
  | 'checkpoint_created'
  | 'checkpoint_failed'
  | 'indexing_started'
  | 'indexing_file_indexed'
  | 'indexing_file_failed'
  | 'indexing_skipped'
  | 'indexing_completed'
  | 'session_sanitization_completed';

export interface AuditEvent {
  timestamp: string;
  type: AuditEventType;
  correlationId?: string;
  workflowId?: string;
  stepId?: string;
  cycleId?: string;
  intent?: string;
  filePath?: string;
  phase?: string;
  status?: string;
  durationMs?: number;
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
    return this.readFile(path.join(this.logDir, `${this.todayKey()}.jsonl`));
  }

  readLast(limit = 50): AuditEvent[] {
    if (!this.enabled) return [];
    try {
      const files = fs.readdirSync(this.logDir)
        .filter((file) => file.endsWith('.jsonl'))
        .sort();
      const events = files.flatMap((file) => this.readFile(path.join(this.logDir, file)));
      return events.slice(-limit);
    } catch {
      return [];
    }
  }

  readByTypes(types: AuditEventType[], limit = 50): AuditEvent[] {
    return this.readLast(limit * 4)
      .filter((event) => types.includes(event.type))
      .slice(-limit);
  }

  private readFile(filePath: string): AuditEvent[] {
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
  const auditLog = instances.get(key);
  if (!auditLog) {
    throw new Error(`Failed to initialize audit log for root: ${projectRoot}`);
  }
  return auditLog;
}

/**
 * @module telemetry
 * @description Opt-in local telemetry for Roadie.
 *   When `telemetry.enabled` is true in `.roadie/config.json` (or ROADIE_TELEMETRY=1),
 *   events are appended to `.roadie/telemetry.jsonl` on disk.
 *   No data is ever sent to external services — this is local-only observability.
 * @inputs TelemetryEvent objects
 * @outputs Appends to .roadie/telemetry/<YYYY-MM-DD>.jsonl
 * @depended-on-by index.ts, workflow-engine.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getConfig } from '../config-loader';

export interface TelemetryEvent {
  /** Event category: e.g. 'intent_classified', 'workflow_completed', 'error' */
  type: string;
  /** ISO 8601 timestamp — auto-set if omitted */
  timestamp?: string;
  /** Arbitrary metadata */
  [key: string]: unknown;
}

export class Telemetry {
  private telemetryDir: string;

  constructor(private projectRoot: string) {
    this.telemetryDir = path.join(projectRoot, '.roadie', 'telemetry');
  }

  /** Record an event. No-op when telemetry is disabled. */
  async recordEvent(event: TelemetryEvent): Promise<void> {
    try {
      const cfg = getConfig();
      if (!cfg.telemetry?.enabled) return;
    } catch {
      // Config not available — skip silently
      return;
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const line: TelemetryEvent = {
      ...event,
      timestamp: event.timestamp ?? now.toISOString(),
    };

    try {
      await fs.mkdir(this.telemetryDir, { recursive: true });
      const filePath = path.join(this.telemetryDir, `${dateStr}.jsonl`);
      await fs.appendFile(filePath, JSON.stringify(line) + '\n', 'utf8');
    } catch {
      // Telemetry write failures are silently swallowed — never crash the server
    }
  }

  /** Read today's telemetry events. Returns [] when disabled or file absent. */
  async readToday(): Promise<TelemetryEvent[]> {
    const dateStr = new Date().toISOString().slice(0, 10);
    const filePath = path.join(this.telemetryDir, `${dateStr}.jsonl`);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TelemetryEvent);
    } catch {
      return [];
    }
  }

  /**
   * Delete telemetry files older than `maxDays` days.
   */
  async pruneOlderThan(maxDays: number): Promise<void> {
    const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
    try {
      const entries = await fs.readdir(this.telemetryDir);
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;
        const dateMatch = entry.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
        if (!dateMatch) continue;
        const entryDate = new Date(dateMatch[1]).getTime();
        if (entryDate < cutoff) {
          await fs.unlink(path.join(this.telemetryDir, entry)).catch(() => undefined);
        }
      }
    } catch {
      // Directory may not exist yet — ignore
    }
  }
}

let _instance: Telemetry | null = null;

/** Singleton accessor — returns the same Telemetry instance across calls with the same root. */
export function getTelemetry(projectRoot: string): Telemetry {
  if (!_instance) {
    _instance = new Telemetry(projectRoot);
  }
  return _instance;
}

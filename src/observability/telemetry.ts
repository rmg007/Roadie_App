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
import { createHash } from 'node:crypto';
import { getConfig } from '../config-loader';

export interface TelemetryEvent {
  /** Event category: e.g. 'intent_classified', 'workflow_completed', 'error' */
  type: string;
  /** ISO 8601 timestamp — auto-set if omitted */
  timestamp?: string;
  /** Arbitrary metadata */
  [key: string]: unknown;
}

type TelemetryProfile = 'minimal' | 'standard' | 'maximum';

interface EffectiveTelemetryConfig {
  enabled: boolean;
  profile: TelemetryProfile;
  retainDays: number;
  capturePromptContent: boolean;
  captureToolArguments: boolean;
  maxEventBytes: number;
}

const SENSITIVE_KEY_PATTERN = /(password|secret|token|api[_-]?key|authorization|cookie)/i;
const CONTENT_KEY_PATTERN = /^(prompt|message|content|text)$/i;

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function sanitizeValue(
  key: string | undefined,
  value: unknown,
  cfg: EffectiveTelemetryConfig,
): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }

  if (key && !cfg.capturePromptContent && CONTENT_KEY_PATTERN.test(key) && typeof value === 'string') {
    return {
      omitted: true,
      length: value.length,
      hash: hashText(value),
    };
  }

  if (key && !cfg.captureToolArguments && (key === 'arguments' || key === 'args')) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return {
        omitted: true,
        keys: Object.keys(value as Record<string, unknown>),
      };
    }
    return { omitted: true, kind: typeof value };
  }

  if (typeof value === 'string') {
    const maxStringLength = cfg.profile === 'maximum' ? 8_000 : cfg.profile === 'standard' ? 2_000 : 512;
    if (value.length > maxStringLength) {
      return `${value.slice(0, maxStringLength)}...[truncated:${value.length - maxStringLength}]`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const maxArrayLength = cfg.profile === 'maximum' ? 200 : cfg.profile === 'standard' ? 80 : 20;
    return value.slice(0, maxArrayLength).map((item) => sanitizeValue(undefined, item, cfg));
  }

  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    const maxObjectKeys = cfg.profile === 'maximum' ? 200 : cfg.profile === 'standard' ? 100 : 40;

    for (const [entryKey, entryValue] of entries.slice(0, maxObjectKeys)) {
      output[entryKey] = sanitizeValue(entryKey, entryValue, cfg);
    }

    if (entries.length > maxObjectKeys) {
      output.__truncatedKeys = entries.length - maxObjectKeys;
    }

    return output;
  }

  return value;
}

export class Telemetry {
  private telemetryDir: string;
  private lastPruneDate: string | null = null;

  constructor(private projectRoot: string) {
    this.telemetryDir = path.join(projectRoot, '.roadie', 'telemetry');
  }

  /** Record an event. No-op when telemetry is disabled. */
  async recordEvent(event: TelemetryEvent): Promise<void> {
    let cfg: EffectiveTelemetryConfig;
    try {
      const loaded = getConfig(this.projectRoot);
      cfg = {
        enabled: loaded.telemetry?.enabled ?? false,
        profile: loaded.telemetry?.profile ?? 'standard',
        retainDays: loaded.telemetry?.retainDays ?? 30,
        capturePromptContent: loaded.telemetry?.capturePromptContent ?? false,
        captureToolArguments: loaded.telemetry?.captureToolArguments ?? true,
        maxEventBytes: loaded.telemetry?.maxEventBytes ?? 65_536,
      };
      if (!cfg.enabled) return;
    } catch {
      // Config not available — skip silently
      return;
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const sanitized = sanitizeValue(undefined, event, cfg) as Record<string, unknown>;
    const timestamp = typeof sanitized.timestamp === 'string' ? sanitized.timestamp : now.toISOString();
    const eventType = typeof sanitized.type === 'string' ? sanitized.type : event.type;
    const line: TelemetryEvent = {
      ...sanitized,
      type: eventType,
      timestamp,
    };

    let serialized = JSON.stringify(line);
    if (Buffer.byteLength(serialized, 'utf8') > cfg.maxEventBytes) {
      const fallback: TelemetryEvent = {
        type: typeof line.type === 'string' ? line.type : 'telemetry_event',
        timestamp,
        truncated: true,
        originalSizeBytes: Buffer.byteLength(serialized, 'utf8'),
      };
      serialized = JSON.stringify(fallback);
    }

    try {
      await fs.mkdir(this.telemetryDir, { recursive: true });
      const filePath = path.join(this.telemetryDir, `${dateStr}.jsonl`);
      await fs.appendFile(filePath, serialized + '\n', 'utf8');

      if (this.lastPruneDate !== dateStr) {
        this.lastPruneDate = dateStr;
        await this.pruneOlderThan(cfg.retainDays);
      }
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
        const datePortion = dateMatch[1];
        if (!datePortion) continue;
        const entryDate = new Date(datePortion).getTime();
        if (entryDate < cutoff) {
          await fs.unlink(path.join(this.telemetryDir, entry)).catch(() => undefined);
        }
      }
    } catch {
      // Directory may not exist yet — ignore
    }
  }
}

const TELEMETRY_INSTANCES = new Map<string, Telemetry>();

/** Singleton accessor — returns the same Telemetry instance across calls with the same root. */
export function getTelemetry(projectRoot: string): Telemetry {
  const resolvedRoot = path.resolve(projectRoot);
  const existing = TELEMETRY_INSTANCES.get(resolvedRoot);
  if (existing) {
    return existing;
  }

  const telemetry = new Telemetry(resolvedRoot);
  TELEMETRY_INSTANCES.set(resolvedRoot, telemetry);
  return telemetry;
}

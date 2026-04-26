import { z } from 'zod';
import { getAuditLog, type AuditEvent } from '../observability/audit-log';
import type { SessionState } from '../engine/session-tracker';

export const CycleDiagnosticsInputSchema = z.object({
  limit: z.number().int().positive().max(100).optional().default(10),
  maxAgeHours: z.number().positive().max(24 * 30).optional().default(24),
  includeRawEvents: z.boolean().optional().default(false),
});

export type CycleDiagnosticsInput = z.infer<typeof CycleDiagnosticsInputSchema>;

interface CycleSummary {
  cycleId: string;
  start: string;
  end?: string;
  status: 'running' | 'completed' | 'failed';
  checkpoint: { status: string; tag?: string };
  indexing: { indexed: number; skipped: number; failed: number };
  errors: string[];
}

interface CycleDiagnosticsResult {
  generatedAt: string;
  cycleCount: number;
  unhealthyCount: number;
  latestSessionState: SessionState;
  cycles: CycleSummary[];
  rawEvents?: AuditEvent[];
}

export function handleCycleDiagnostics(
  input: CycleDiagnosticsInput,
  projectRoot: string,
  latestSessionState: SessionState,
): CycleDiagnosticsResult {
  const audit = getAuditLog(projectRoot);
  const cutoff = Date.now() - input.maxAgeHours * 60 * 60 * 1000;
  const recentEvents = audit
    .readLast(Math.max(input.limit * 20, 50))
    .filter((event) => Date.parse(event.timestamp) >= cutoff);

  const cycles = new Map<string, CycleSummary>();

  for (const event of recentEvents) {
    if (!event.cycleId) continue;
    const cycle = cycles.get(event.cycleId) ?? {
      cycleId: event.cycleId,
      start: event.timestamp,
      status: 'running',
      checkpoint: { status: 'unknown' },
      indexing: { indexed: 0, skipped: 0, failed: 0 },
      errors: [],
    };

    switch (event.type) {
      case 'cycle_started':
        cycle.start = event.timestamp;
        break;
      case 'checkpoint_created':
        cycle.checkpoint = { status: 'created', ...(event.message !== undefined ? { tag: event.message } : {}) };
        break;
      case 'checkpoint_failed':
        cycle.checkpoint = { status: 'failed', ...(event.message !== undefined ? { tag: event.message } : {}) };
        if (event.message) cycle.errors.push(event.message);
        break;
      case 'indexing_file_indexed':
        cycle.indexing.indexed += 1;
        break;
      case 'indexing_skipped':
        cycle.indexing.skipped += 1;
        break;
      case 'indexing_file_failed':
        cycle.indexing.failed += 1;
        if (event.message) cycle.errors.push(event.message);
        break;
      case 'cycle_completed':
        cycle.status = 'completed';
        cycle.end = event.timestamp;
        break;
      case 'cycle_failed':
        cycle.status = 'failed';
        cycle.end = event.timestamp;
        if (event.message) cycle.errors.push(event.message);
        break;
      default:
        break;
    }

    cycles.set(event.cycleId, cycle);
  }

  const cycleList = Array.from(cycles.values())
    .sort((left, right) => Date.parse(right.start) - Date.parse(left.start))
    .slice(0, input.limit);

  return {
    generatedAt: new Date().toISOString(),
    cycleCount: cycleList.length,
    unhealthyCount: cycleList.filter((cycle) => cycle.status === 'failed' || cycle.errors.length > 0).length,
    latestSessionState,
    cycles: cycleList,
    ...(input.includeRawEvents ? { rawEvents: recentEvents as AuditEvent[] } : {}),
  };
}

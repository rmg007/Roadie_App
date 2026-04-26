/**
 * @module session-tracker
 * @description Tracks and persists the state of the current Roadie session.
 *   Enables 'Resume After Crash' functionality.
 */

/* eslint-disable no-restricted-syntax -- Session state bootstrap is intentionally synchronous to guarantee deterministic startup state. */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SessionStateSchema } from '../schemas';

export interface SessionState {
  status: 'idle' | 'in_progress' | 'completed' | 'failed';
  currentPhase?: string | undefined;
  lastCheckpoint?: string | undefined;
  startTime: string;
  lastUpdated: string;
  filesProcessed: string[];
}

export class SessionTracker {
  private readonly stateFilePath: string;
  private currentState: SessionState;

  constructor(projectRoot: string) {
    const roadieDir = path.join(projectRoot, '.roadie');
    if (!fs.existsSync(roadieDir)) {
      fs.mkdirSync(roadieDir, { recursive: true });
    }
    this.stateFilePath = path.join(roadieDir, 'session-state.json');
    this.currentState = this.loadState();
  }

  private loadState(): SessionState {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const data = fs.readFileSync(this.stateFilePath, 'utf8');
        const parsed = JSON.parse(data);
        const normalized = this.normalizeState(parsed);
        const validation = SessionStateSchema.safeParse(normalized);
        if (validation.success) {
          return validation.data;
        }
      } catch {
        // Fallback to fresh state
      }
    }
    return this.createFreshState();
  }

  private createFreshState(): SessionState {
    return {
      status: 'idle',
      startTime: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      filesProcessed: []
    };
  }

  private normalizeFilesProcessed(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }

  private normalizeState(raw: unknown): SessionState {
    const base = this.createFreshState();
    const candidate = typeof raw === 'object' && raw !== null ? raw as Partial<SessionState> : {};

    return {
      status: candidate.status ?? base.status,
      ...(typeof candidate.currentPhase === 'string' ? { currentPhase: candidate.currentPhase } : {}),
      ...(typeof candidate.lastCheckpoint === 'string' ? { lastCheckpoint: candidate.lastCheckpoint } : {}),
      startTime: typeof candidate.startTime === 'string' ? candidate.startTime : base.startTime,
      lastUpdated: typeof candidate.lastUpdated === 'string' ? candidate.lastUpdated : base.lastUpdated,
      filesProcessed: this.normalizeFilesProcessed(candidate.filesProcessed),
    };
  }

  public getState(): SessionState {
    return this.currentState;
  }

  public async updateState(patch: Partial<SessionState>): Promise<void> {
    this.currentState = this.normalizeState({
      ...this.currentState,
      ...patch,
      lastUpdated: new Date().toISOString()
    });
    await fs.promises.writeFile(this.stateFilePath, JSON.stringify(this.currentState, null, 2));
  }

  public async finishSession(status: 'completed' | 'failed' = 'completed'): Promise<void> {
    await this.updateState({ status, currentPhase: 'Completed' });
  }

  public hasIncompleteSession(): boolean {
    return this.currentState.status === 'in_progress';
  }
}

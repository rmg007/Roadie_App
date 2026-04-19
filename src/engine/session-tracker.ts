/**
 * @module session-tracker
 * @description Tracks and persists the state of the current Roadie session.
 *   Enables 'Resume After Crash' functionality.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SessionState {
  status: 'idle' | 'in_progress' | 'completed' | 'failed';
  currentPhase?: string;
  lastCheckpoint?: string;
  startTime: string;
  lastUpdated: string;
  filesProcessed: string[];
}

export class SessionTracker {
  private readonly stateFilePath: string;
  private currentState: SessionState;

  constructor(projectRoot: string) {
    const roadieDir = path.join(projectRoot, '.github', '.roadie');
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
        return JSON.parse(data);
      } catch {
        // Fallback to fresh state
      }
    }
    return {
      status: 'idle',
      startTime: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      filesProcessed: []
    };
  }

  public getState(): SessionState {
    return this.currentState;
  }

  public async updateState(patch: Partial<SessionState>): Promise<void> {
    this.currentState = {
      ...this.currentState,
      ...patch,
      lastUpdated: new Date().toISOString()
    };
    await fs.promises.writeFile(this.stateFilePath, JSON.stringify(this.currentState, null, 2));
  }

  public async finishSession(status: 'completed' | 'failed' = 'completed'): Promise<void> {
    await this.updateState({ status });
  }

  public hasIncompleteSession(): boolean {
    return this.currentState.status === 'in_progress';
  }
}

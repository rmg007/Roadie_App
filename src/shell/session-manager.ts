/**
 * @module session-manager
 * @description Tracks conversation state across chat turns, routing to paused workflows.
 *   Maintains per-thread session metadata (threadId, workflowId, paused status, pausedSessionId).
 *   Allows chat-participant to resume interrupted workflows without re-classifying intent.
 * @inputs threadId (from vscode.ChatContext), workflowId, pausedSessionId
 * @outputs Session state (getSession, markPaused, resumeFromPaused, setWorkflow)
 * @depends-on types.ts
 * @depended-on-by chat-participant.ts
 */

/**
 * Represents an incomplete workflow available for resumption.
 */
export interface IncompleteWorkflow {
  id: string; // Unique ID for the workflow snapshot
  workflowId: string; // Type of workflow (bug_fix, feature, etc.)
  progress: string; // Human-readable progress summary
}

/**
 * Represents the state of a single conversation thread.
 */
export interface ConversationSession {
  threadId: string;
  workflowId?: string; // Last workflow executed in this thread
  paused: boolean; // True if waiting to resume a paused workflow
  pausedSessionId?: string; // Reference to PausedWorkflowSession in WorkflowEngine
}

/**
 * SessionManager tracks conversation state across chat turns.
 * Keyed by threadId, supports routing to paused workflow resumption.
 */
export class SessionManager {
  private sessions: Map<string, ConversationSession> = new Map();
  // H8: Learning database for querying incomplete workflows
  private learningDb?: any;

  /**
   * Get or create a session for the given threadId.
   *
   * @param threadId Unique conversation thread ID from vscode.ChatContext
   * @returns Existing or newly created ConversationSession
   */
  getSession(threadId: string): ConversationSession {
    if (!this.sessions.has(threadId)) {
      this.sessions.set(threadId, {
        threadId,
        workflowId: undefined,
        paused: false,
        pausedSessionId: undefined,
      });
    }
    return this.sessions.get(threadId)!;
  }

  /**
   * Set the current workflow for this thread.
   * Called when a new workflow starts.
   *
   * @param threadId Unique conversation thread ID
   * @param workflowId ID of the workflow being executed
   */
  setWorkflow(threadId: string, workflowId: string): void {
    const session = this.getSession(threadId);
    session.workflowId = workflowId;
    session.paused = false;
    session.pausedSessionId = undefined;
  }

  /**
   * Mark a session as paused, storing the sessionId from WorkflowEngine.
   * Called when a workflow pauses due to requiresApproval or step failure.
   *
   * @param threadId Unique conversation thread ID
   * @param pausedSessionId Reference to PausedWorkflowSession in WorkflowEngine
   */
  markPaused(threadId: string, pausedSessionId: string): void {
    const session = this.getSession(threadId);
    session.paused = true;
    session.pausedSessionId = pausedSessionId;
  }

  /**
   * Resume from a paused workflow, clearing the paused flag.
   * Called after user approval is processed and resumption is triggered.
   *
   * @param threadId Unique conversation thread ID
   */
  resumeFromPaused(threadId: string): void {
    const session = this.getSession(threadId);
    session.paused = false;
    // Keep pausedSessionId for logging; it will be overwritten on next pause
  }

  /**
   * Clear all sessions. Useful for testing.
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Get all active sessions. Useful for debugging/monitoring.
   *
   * @returns Array of all ConversationSession objects
   */
  getAllSessions(): ConversationSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Set the learning database for querying incomplete workflows (H8).
   *
   * @param learningDb LearningDatabase instance for snapshot queries
   */
  setLearningDatabase(learningDb: any): void {
    this.learningDb = learningDb;
  }

  /**
   * List all incomplete workflows available for resumption in the given thread.
   * H8: Queries learning database for paused/saved workflow snapshots.
   *
   * @param threadId Unique conversation thread ID
   * @returns Array of IncompleteWorkflow objects (name, progress)
   */
  listIncompleteWorkflows(threadId: string): IncompleteWorkflow[] {
    // H8: Query learning database for incomplete workflows
    if (!this.learningDb) {
      return [];
    }

    try {
      const snapshots = this.learningDb.listIncompleteWorkflows(threadId);
      return snapshots.map((snapshot: any) => ({
        id: snapshot.id,
        workflowId: snapshot.workflowId,
        progress: `${snapshot.currentStepIndex + 1}/${snapshot.stepResults.length} steps completed`,
      }));
    } catch {
      // Non-fatal — return empty array if query fails
      return [];
    }
  }
}

/**
 * @module session-manager.test
 * @description Unit tests for SessionManager — conversation state tracking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from './session-manager';

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  it('creates a new session on first access', () => {
    const session = sessionManager.getSession('thread-1');
    expect(session).toBeDefined();
    expect(session.threadId).toBe('thread-1');
    expect(session.paused).toBe(false);
    expect(session.workflowId).toBeUndefined();
    expect(session.pausedSessionId).toBeUndefined();
  });

  it('returns existing session on subsequent access', () => {
    const session1 = sessionManager.getSession('thread-1');
    session1.workflowId = 'bug_fix';
    const session2 = sessionManager.getSession('thread-1');
    expect(session2.workflowId).toBe('bug_fix');
    expect(session1 === session2).toBe(true);
  });

  it('sets workflow ID and clears paused state', () => {
    const session = sessionManager.getSession('thread-1');
    session.paused = true;
    session.pausedSessionId = 'paused-123';

    sessionManager.setWorkflow('thread-1', 'bug_fix');
    expect(session.workflowId).toBe('bug_fix');
    expect(session.paused).toBe(false);
    expect(session.pausedSessionId).toBeUndefined();
  });

  it('marks session as paused with sessionId', () => {
    sessionManager.setWorkflow('thread-1', 'feature');
    sessionManager.markPaused('thread-1', 'paused-456');

    const session = sessionManager.getSession('thread-1');
    expect(session.paused).toBe(true);
    expect(session.pausedSessionId).toBe('paused-456');
    expect(session.workflowId).toBe('feature');
  });

  it('resumes from paused state', () => {
    sessionManager.setWorkflow('thread-1', 'refactor');
    sessionManager.markPaused('thread-1', 'paused-789');
    sessionManager.resumeFromPaused('thread-1');

    const session = sessionManager.getSession('thread-1');
    expect(session.paused).toBe(false);
    expect(session.workflowId).toBe('refactor');
    expect(session.pausedSessionId).toBe('paused-789'); // Preserved for logging
  });

  it('handles multiple threads independently', () => {
    const thread1 = sessionManager.getSession('thread-1');
    const thread2 = sessionManager.getSession('thread-2');

    sessionManager.setWorkflow('thread-1', 'bug_fix');
    sessionManager.setWorkflow('thread-2', 'feature');

    expect(thread1.workflowId).toBe('bug_fix');
    expect(thread2.workflowId).toBe('feature');

    sessionManager.markPaused('thread-1', 'paused-1');
    expect(thread1.paused).toBe(true);
    expect(thread2.paused).toBe(false);
  });

  it('clears all sessions', () => {
    sessionManager.getSession('thread-1');
    sessionManager.getSession('thread-2');
    sessionManager.getSession('thread-3');

    expect(sessionManager.getAllSessions()).toHaveLength(3);
    sessionManager.clear();
    expect(sessionManager.getAllSessions()).toHaveLength(0);
  });

  it('returns all active sessions', () => {
    sessionManager.getSession('thread-1');
    sessionManager.getSession('thread-2');

    const allSessions = sessionManager.getAllSessions();
    expect(allSessions).toHaveLength(2);
    expect(allSessions.map((s) => s.threadId)).toEqual(['thread-1', 'thread-2']);
  });
});

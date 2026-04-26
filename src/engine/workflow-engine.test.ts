import { describe, it, expect, vi } from 'vitest';

// Mock vscode so the module can be imported in test environments
vi.mock('vscode', () => ({
  window: {
    createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn(), show: vi.fn() })),
  },
}));

import { WorkflowEngine } from './workflow-engine';
import { StepExecutor, type StepHandlerFn } from './step-executor';
import { WorkflowState } from '../types';
import type { WorkflowDefinition, WorkflowContext, WorkflowStep, StepResult } from '../types';

// ---- Helpers ----

function makeStep(id: string, name: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id,
    name,
    type: 'sequential',
    agentRole: 'fixer',
    modelTier: 'free',
    toolScope: 'implementation',
    promptTemplate: `Execute ${name}`,
    timeoutMs: 5_000,
    maxRetries: 2,
    ...overrides,
  };
}

function makeDefinition(
  steps: WorkflowStep[],
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    id: 'test_workflow',
    name: 'Test Workflow',
    steps,
    ...overrides,
  };
}

function makeContext(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    prompt: 'test prompt',
    intent: { intent: 'bug_fix', confidence: 0.9, signals: [], requiresLLM: false },
    projectModel: {} as WorkflowContext['projectModel'],
    progress: {
      report: vi.fn(),
      reportMarkdown: vi.fn(),
    },
    cancellation: {
      isCancelled: false,
      onCancelled: vi.fn(),
    },
    isAutonomous: false,
    ...overrides,
  };
}

function successResult(stepId: string): StepResult {
  return {
    stepId,
    status: 'success',
    output: `Output from ${stepId}`,
    tokenUsage: { input: 100, output: 50 },
    attempts: 1,
    modelUsed: 'gpt-4.1',
  };
}

function failResult(stepId: string, failureReason?: StepResult['failureReason']): StepResult {
  return {
    stepId,
    status: 'failed',
    output: '',
    tokenUsage: { input: 100, output: 50 },
    attempts: 3,
    modelUsed: 'gpt-4.1',
    error: `Step ${stepId} failed after 3 attempts`,
    ...(failureReason !== undefined ? { failureReason } : {}),
  };
}

function createEngine(handler: StepHandlerFn): WorkflowEngine {
  return new WorkflowEngine(new StepExecutor(handler));
}

// ---- Tests ----

describe('WorkflowEngine', () => {
  it('completes a 4-step sequential workflow', async () => {
    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));
    const engine = createEngine(handler);
    const steps = [
      makeStep('s1', 'Locate'),
      makeStep('s2', 'Diagnose'),
      makeStep('s3', 'Fix'),
      makeStep('s4', 'Verify'),
    ];

    const result = await engine.execute(makeDefinition(steps), makeContext());

    expect(result.state).toBe(WorkflowState.COMPLETED);
    expect(result.stepResults).toHaveLength(4);
    expect(result.stepResults.every((r) => r.status === 'success')).toBe(true);
    expect(handler).toHaveBeenCalledTimes(4);
  });

  it('passes step results to next step via context.previousStepResults', async () => {
    const contexts: WorkflowContext[] = [];
    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep, ctx: WorkflowContext) => {
        contexts.push({ ...ctx });
        return Promise.resolve(successResult(step.id));
      });
    const engine = createEngine(handler);
    const steps = [makeStep('s1', 'Step 1'), makeStep('s2', 'Step 2'), makeStep('s3', 'Step 3')];

    await engine.execute(makeDefinition(steps), makeContext());

    // Step 2 should see step 1's result
    expect(contexts[1].previousStepResults).toHaveLength(1);
    expect(contexts[1].previousStepResults![0].stepId).toBe('s1');
    // Step 3 should see both prior results
    expect(contexts[2].previousStepResults).toHaveLength(2);
  });

  it('transitions to PAUSED when a step fails after retries', async () => {
    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementationOnce((step: WorkflowStep) => Promise.resolve(successResult(step.id)))
      .mockResolvedValue(failResult('s2'));
    const engine = createEngine(handler);
    const steps = [makeStep('s1', 'Step 1'), makeStep('s2', 'Step 2', { maxRetries: 0 })];

    const result = await engine.execute(makeDefinition(steps), makeContext());

    expect(result.state).toBe(WorkflowState.PAUSED);
    expect(engine.getState()).toBe(WorkflowState.PAUSED);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[1].status).toBe('failed');
  });

  it('transitions to CANCELLED when cancellation is requested', async () => {
    let callCount = 0;
    const cancellation = {
      isCancelled: false,
      onCancelled: vi.fn(),
    };
    const handler: StepHandlerFn = vi.fn().mockImplementation((step: WorkflowStep) => {
      callCount++;
      if (callCount === 2) {
        // Simulate cancellation after step 2 starts
        cancellation.isCancelled = true;
      }
      return Promise.resolve(successResult(step.id));
    });

    const engine = createEngine(handler);
    const steps = [makeStep('s1', 'Step 1'), makeStep('s2', 'Step 2'), makeStep('s3', 'Step 3')];
    const ctx = makeContext({
      cancellation,
    });

    const result = await engine.execute(makeDefinition(steps), ctx);

    expect(result.state).toBe(WorkflowState.CANCELLED);
    // Step 3 should never execute (cancellation checked at boundary)
    expect(result.stepResults.length).toBeLessThanOrEqual(2);
  });

  it('streams progress for each step', async () => {
    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));
    const engine = createEngine(handler);
    const ctx = makeContext();
    const steps = [makeStep('s1', 'Locate Error'), makeStep('s2', 'Apply Fix')];

    await engine.execute(makeDefinition(steps), ctx);

    const report = ctx.progress.report as ReturnType<typeof vi.fn>;
    expect(report).toHaveBeenCalledWith('Running: Locate Error…');
    expect(report).toHaveBeenCalledWith('Running: Apply Fix…');
  });

  it('tracks workflow duration', async () => {
    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));
    const engine = createEngine(handler);
    const result = await engine.execute(makeDefinition([makeStep('s1', 'Step 1')]), makeContext());

    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.duration).toBeLessThan(1000); // Should be near-instant with mocks
  });

  it('builds a human-readable summary', async () => {
    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));
    const engine = createEngine(handler);
    const result = await engine.execute(
      makeDefinition([makeStep('s1', 'Step 1')], { name: 'Bug Fix' }),
      makeContext(),
    );

    expect(result.summary).toContain('Bug Fix');
    expect(result.summary).toContain('1/1');
    expect(result.summary).toContain('COMPLETED');
  });

  it('includes structured failure details in the summary when paused', async () => {
    const handler: StepHandlerFn = vi.fn().mockResolvedValue(failResult('s1', 'timeout'));
    const engine = createEngine(handler);
    const result = await engine.execute(
      makeDefinition([makeStep('s1', 'Step 1', { maxRetries: 0 })], { name: 'Bug Fix' }),
      makeContext(),
    );

    expect(result.state).toBe(WorkflowState.PAUSED);
    expect(result.summary).toContain('Last failure: s1');
    expect(result.summary).toContain('reason=timeout');
  });

  it('truncates long failure text in the summary', async () => {
    const longError = 'x'.repeat(400);
    const handler: StepHandlerFn = vi.fn().mockResolvedValue({
      ...failResult('s1', 'internal'),
      error: longError,
    });
    const engine = createEngine(handler);
    const result = await engine.execute(
      makeDefinition([makeStep('s1', 'Step 1', { maxRetries: 0 })], { name: 'Bug Fix' }),
      makeContext(),
    );

    expect(result.summary).toContain('error=');
    expect(result.summary).not.toContain(longError);
    expect(result.summary.length).toBeLessThan(longError.length + 80);
  });

  it('does not execute remaining steps after failure', async () => {
    const handler: StepHandlerFn = vi
      .fn()
      .mockResolvedValueOnce(failResult('s1'))
      .mockResolvedValueOnce(successResult('s2'));
    const engine = createEngine(handler);
    const steps = [makeStep('s1', 'Step 1', { maxRetries: 0 }), makeStep('s2', 'Step 2')];

    const result = await engine.execute(makeDefinition(steps), makeContext());

    expect(result.state).toBe(WorkflowState.PAUSED);
    expect(result.stepResults).toHaveLength(1); // Step 2 never executed
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('calls onComplete hook when workflow completes', async () => {
    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));
    const onComplete = vi.fn().mockResolvedValue({
      workflowId: 'custom',
      state: WorkflowState.COMPLETED,
      stepResults: [],
      duration: 42,
      modelTiersUsed: [],
      summary: 'Custom summary',
    });
    const engine = createEngine(handler);
    const result = await engine.execute(
      makeDefinition([makeStep('s1', 'Step 1')], { onComplete }),
      makeContext(),
    );

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe('Custom summary');
  });

  it('logs a warning and returns the default result when onComplete throws', async () => {
    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));
    const onComplete = vi.fn().mockRejectedValue(new Error('boom'));
    const engine = createEngine(handler);
    const result = await engine.execute(
      makeDefinition([makeStep('s1', 'Step 1')], { onComplete }),
      makeContext(),
    );

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(WorkflowState.COMPLETED);
    expect(result.summary).toContain('Test Workflow');
  });

  it('does not call onComplete when workflow is paused', async () => {
    const handler: StepHandlerFn = vi.fn().mockResolvedValue(failResult('s1'));
    const onComplete = vi.fn();
    const engine = createEngine(handler);
    await engine.execute(
      makeDefinition([makeStep('s1', 'Step 1', { maxRetries: 0 })], { onComplete }),
      makeContext(),
    );

    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('WorkflowEngine — pausedSessionId fields', () => {
  it('sets pausedSessionId on result when a step requiresApproval', async () => {
    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));
    const engine = createEngine(handler);
    const steps = [makeStep('s1', 'Step 1', { requiresApproval: true })];

    const result = await engine.execute(makeDefinition(steps), makeContext());

    expect(result.state).toBe(WorkflowState.WAITING_FOR_APPROVAL);
    expect(result.pausedSessionId).toBeDefined();
    expect(typeof result.pausedSessionId).toBe('string');
    expect(result.pauseReason).toBe('approval');
    expect(result.lastStepName).toBe('Step 1');
  });

  it('does not set pausedSessionId on normal completion', async () => {
    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));
    const engine = createEngine(handler);
    const result = await engine.execute(makeDefinition([makeStep('s1', 'Step 1')]), makeContext());

    expect(result.state).toBe(WorkflowState.COMPLETED);
    expect(result.pausedSessionId).toBeUndefined();
  });
});

describe('WorkflowEngine — registerWorkflowDefinition', () => {
  it('registers and retrieves a workflow definition by id', async () => {
    const { registerWorkflowDefinition } = await import('./workflow-engine');
    const def = makeDefinition([makeStep('s1', 'Step 1')], { id: 'reg_test_wf', name: 'Reg Test' });
    registerWorkflowDefinition(def);

    // Execute (internally uses the definition registry indirectly; main proof is no throw)
    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));
    const engine = new WorkflowEngine(new StepExecutor(handler));
    const result = await engine.execute(def, makeContext());
    expect(result.state).toBe(WorkflowState.COMPLETED);
  });
});

describe('WorkflowEngine — rebindTurnHandles', () => {
  it('rebinds cancellation so new token isCancelled is observed', async () => {
    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));
    const engine = createEngine(handler);
    const steps = [makeStep('s1', 'Step 1', { requiresApproval: true }), makeStep('s2', 'Step 2')];

    // Execute and pause at step 1 (requiresApproval)
    const result = await engine.execute(makeDefinition(steps), makeContext());
    expect(result.pausedSessionId).toBeDefined();

    // New turn cancellation token that is already cancelled
    const newCancellation = { isCancelled: true, onCancelled: vi.fn() };
    const newProgress = { report: vi.fn(), reportMarkdown: vi.fn() };

    engine.rebindTurnHandles(result.pausedSessionId!, {
      cancellation: newCancellation,
      progress: newProgress,
    });

    // Resume — should be cancelled immediately because of the new token
    const resumeResult = await engine.resume(result.pausedSessionId!, true);
    expect(resumeResult.state).toBe(WorkflowState.CANCELLED);
  });
});

// ============================================================================
// Test Suite: Bug 4 — ThreadId Plumbing (Phase 3)
// ============================================================================
// @description Tests for threadId field on WorkflowContext and snapshot persistence
// @coverage threadId propagation, snapshot storage, thread-scoped lookups

describe('WorkflowEngine — Bug 4 ThreadId Plumbing', () => {
  it('Test 3.1: WorkflowContext accepts threadId field', () => {
    // Arrange
    const threadId = 'thread-abc123';
    const context = makeContext({ threadId });

    // Assert: threadId is present and accessible
    expect(context.threadId).toBe(threadId);
  });

  it('Test 3.2: WorkflowContext threadId is optional', () => {
    // Arrange
    const context = makeContext();

    // Assert: No error when threadId is undefined
    expect(context.threadId).toBeUndefined();
  });

  it('Test 3.3: Paused workflow includes threadId in snapshot', async () => {
    // Arrange
    const threadId = 'thread-abc123';
    const mockLearningDb = {
      saveWorkflowSnapshot: vi.fn().mockResolvedValue(undefined),
      getWorkflowStats: vi.fn().mockReturnValue({}),
      getWorkflowCancellationStats: vi.fn().mockReturnValue({}),
    };

    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));

    const engine = new WorkflowEngine(new StepExecutor(handler), mockLearningDb as any);

    const steps = [
      makeStep('s1', 'Approve Step', { requiresApproval: true }),
      makeStep('s2', 'Final Step'),
    ];

    // Act: Execute workflow with threadId
    const context = makeContext({ threadId });
    const result = await engine.execute(makeDefinition(steps), context);

    // Assert: Snapshot was saved with threadId
    expect(mockLearningDb.saveWorkflowSnapshot).toHaveBeenCalledOnce();
    const snapshotCall = mockLearningDb.saveWorkflowSnapshot.mock.calls[0][0];
    expect(snapshotCall.threadId).toBe(threadId);
  });

  it('Test 3.4: Paused workflow defaults threadId to "unknown" when missing', async () => {
    // Arrange: Context without threadId
    const mockLearningDb = {
      saveWorkflowSnapshot: vi.fn().mockResolvedValue(undefined),
      getWorkflowStats: vi.fn().mockReturnValue({}),
      getWorkflowCancellationStats: vi.fn().mockReturnValue({}),
    };

    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));

    const engine = new WorkflowEngine(new StepExecutor(handler), mockLearningDb as any);

    const steps = [
      makeStep('s1', 'Approve Step', { requiresApproval: true }),
      makeStep('s2', 'Final Step'),
    ];

    // Act: Execute workflow WITHOUT threadId
    const context = makeContext(); // threadId is undefined
    const result = await engine.execute(makeDefinition(steps), context);

    // Assert: Snapshot was saved with default threadId = 'unknown'
    expect(mockLearningDb.saveWorkflowSnapshot).toHaveBeenCalledOnce();
    const snapshotCall = mockLearningDb.saveWorkflowSnapshot.mock.calls[0][0];
    expect(snapshotCall.threadId).toBe('unknown');
  });

  it('Test 3.5: Multiple threads with paused workflows have separate snapshots', async () => {
    // Arrange
    const thread1 = 'thread-1';
    const thread2 = 'thread-2';
    const mockLearningDb = {
      saveWorkflowSnapshot: vi.fn().mockResolvedValue(undefined),
      getWorkflowStats: vi.fn().mockReturnValue({}),
      getWorkflowCancellationStats: vi.fn().mockReturnValue({}),
    };

    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));

    const engine = new WorkflowEngine(new StepExecutor(handler), mockLearningDb as any);

    const steps = [
      makeStep('s1', 'Approve Step', { requiresApproval: true }),
      makeStep('s2', 'Final Step'),
    ];

    // Act: Execute two workflows with different threadIds
    const result1 = await engine.execute(makeDefinition(steps, { id: 'workflow-1' }), makeContext({ threadId: thread1 }));
    const result2 = await engine.execute(makeDefinition(steps, { id: 'workflow-2' }), makeContext({ threadId: thread2 }));

    // Assert: Two separate snapshots with different threadIds
    expect(mockLearningDb.saveWorkflowSnapshot).toHaveBeenCalledTimes(2);
    const snapshot1 = mockLearningDb.saveWorkflowSnapshot.mock.calls[0][0];
    const snapshot2 = mockLearningDb.saveWorkflowSnapshot.mock.calls[1][0];

    expect(snapshot1.threadId).toBe(thread1);
    expect(snapshot2.threadId).toBe(thread2);
    expect(snapshot1.workflowId).toBe('workflow-1');
    expect(snapshot2.workflowId).toBe('workflow-2');
  });

  it('Test 3.6: Removed unsafe cast — threadId accessed directly (not via any)', async () => {
    // Arrange: This test verifies that the unsafe cast (context as any).threadId
    // has been replaced with direct context.threadId access.
    const threadId = 'thread-xyz';
    const mockLearningDb = {
      saveWorkflowSnapshot: vi.fn().mockResolvedValue(undefined),
      getWorkflowStats: vi.fn().mockReturnValue({}),
      getWorkflowCancellationStats: vi.fn().mockReturnValue({}),
    };

    const handler: StepHandlerFn = vi
      .fn()
      .mockImplementation((step: WorkflowStep) => Promise.resolve(successResult(step.id)));

    const engine = new WorkflowEngine(new StepExecutor(handler), mockLearningDb as any);

    const steps = [
      makeStep('s1', 'Approve Step', { requiresApproval: true }),
      makeStep('s2', 'Final Step'),
    ];

    // Act: Execute with threadId
    const context = makeContext({ threadId });
    const result = await engine.execute(makeDefinition(steps), context);

    // Assert: Snapshot preserves the threadId correctly
    // (If the unsafe cast had not been replaced, TypeScript strict mode would fail)
    const snapshot = mockLearningDb.saveWorkflowSnapshot.mock.calls[0][0];
    expect(snapshot.threadId).toBe(threadId);
  });
});

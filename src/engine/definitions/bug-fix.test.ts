import { describe, it, expect, vi } from 'vitest';

// Mock vscode so the module can be imported in test environments
vi.mock('vscode', () => ({
  window: { createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn(), show: vi.fn() })) },
}));

import { BUG_FIX_WORKFLOW } from './bug-fix';
import { WorkflowEngine } from '../workflow-engine';
import { StepExecutor, type StepHandlerFn } from '../step-executor';
import type { WorkflowContext, WorkflowStep, StepResult } from '../../types';
import { WorkflowState } from '../../types';

// ---- Helpers ----

function makeContext(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    prompt: 'The login page throws a 500 error',
    intent: { intent: 'bug_fix', confidence: 0.9, signals: ['keyword:fix', 'signal:500-error'], requiresLLM: false },
    projectModel: {} as WorkflowContext['projectModel'],
    progress: {
      report: vi.fn(),
      reportMarkdown: vi.fn(),
    },
    cancellation: {
      isCancelled: false,
      onCancelled: vi.fn(),
    },
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

// ---- Definition structure tests ----

describe('Bug Fix Workflow Definition', () => {
  it('has id "bug_fix"', () => {
    expect(BUG_FIX_WORKFLOW.id).toBe('bug_fix');
  });

  it('has 8 sequential steps', () => {
    expect(BUG_FIX_WORKFLOW.steps).toHaveLength(8);
  });

  it('step 1 is locate-error with diagnostician role', () => {
    const s = BUG_FIX_WORKFLOW.steps[0];
    expect(s.id).toBe('locate-error');
    expect(s.agentRole).toBe('diagnostician');
    expect(s.modelTier).toBe('standard');
    expect(s.toolScope).toBe('research');
  });

  it('step 2 is diagnose with premium tier', () => {
    const s = BUG_FIX_WORKFLOW.steps[1];
    expect(s.id).toBe('diagnose-root-cause');
    expect(s.modelTier).toBe('premium');
  });

  it('step 3 (write-reproduction-test) is TDD step with test_reviewer role', () => {
    const s = BUG_FIX_WORKFLOW.steps[2];
    expect(s.id).toBe('write-reproduction-test');
    expect(s.agentRole).toBe('test_reviewer');
    expect(s.modelTier).toBe('standard');
  });

  it('step 4 (generate-fix) has maxRetries=3 for escalation', () => {
    const s = BUG_FIX_WORKFLOW.steps[3];
    expect(s.id).toBe('generate-fix');
    expect(s.maxRetries).toBe(3);
    expect(s.agentRole).toBe('fixer');
    expect(s.toolScope).toBe('implementation');
  });

  it('step 5 (verify-fix) has 300s timeout', () => {
    const s = BUG_FIX_WORKFLOW.steps[4];
    expect(s.id).toBe('verify-fix');
    expect(s.timeoutMs).toBe(300_000);
  });

  it('step 8 is summary with documentarian role', () => {
    const s = BUG_FIX_WORKFLOW.steps[7];
    expect(s.id).toBe('generate-summary');
    expect(s.agentRole).toBe('documentarian');
  });

  it('all steps have prompt templates', () => {
    for (const step of BUG_FIX_WORKFLOW.steps) {
      expect(step.promptTemplate.length).toBeGreaterThan(10);
    }
  });
});

// ---- Integration: workflow engine executes bug fix ----

describe('Bug Fix Workflow Execution', () => {
  it('completes all 8 steps with mock handler', async () => {
    const handler: StepHandlerFn = vi.fn().mockImplementation(
      (step: WorkflowStep) => Promise.resolve(successResult(step.id)),
    );
    const engine = new WorkflowEngine(new StepExecutor(handler));
    const result = await engine.execute(BUG_FIX_WORKFLOW, makeContext());

    expect(result.state).toBe(WorkflowState.COMPLETED);
    expect(result.stepResults).toHaveLength(8);
    expect(result.stepResults.every((r) => r.status === 'success')).toBe(true);
  });

  it('streams progress for each step name', async () => {
    const handler: StepHandlerFn = vi.fn().mockImplementation(
      (step: WorkflowStep) => Promise.resolve(successResult(step.id)),
    );
    const engine = new WorkflowEngine(new StepExecutor(handler));
    const ctx = makeContext();
    await engine.execute(BUG_FIX_WORKFLOW, ctx);

    const report = ctx.progress.report as ReturnType<typeof vi.fn>;
    expect(report).toHaveBeenCalledWith(expect.stringContaining('Locating error source'));
    expect(report).toHaveBeenCalledWith(expect.stringContaining('Diagnosing root cause'));
    expect(report).toHaveBeenCalledWith(expect.stringContaining('Generating fix'));
    expect(report).toHaveBeenCalledWith(expect.stringContaining('Verifying with full suite'));
    expect(report).toHaveBeenCalledWith(expect.stringContaining('Generating final audit'));
  });

  it('passes step results to subsequent steps', async () => {
    const contexts: WorkflowContext[] = [];
    const handler: StepHandlerFn = vi.fn().mockImplementation(
      (step: WorkflowStep, ctx: WorkflowContext) => {
        contexts.push({ ...ctx });
        return Promise.resolve(successResult(step.id));
      },
    );
    const engine = new WorkflowEngine(new StepExecutor(handler));
    await engine.execute(BUG_FIX_WORKFLOW, makeContext());

    // Step 2 (diagnose) should have step 1's result
    expect(contexts[1].previousStepResults).toHaveLength(1);
    expect(contexts[1].previousStepResults![0].stepId).toBe('locate-error');
  });

  it('pauses workflow when step 3 fails after all retries', async () => {
    let callCount = 0;
    const handler: StepHandlerFn = vi.fn().mockImplementation((step: WorkflowStep) => {
      callCount++;
      // Steps 1-2 succeed, step 3 always fails
      if (step.id === 'generate-fix') {
        return Promise.resolve({
          stepId: step.id,
          status: 'failed' as const,
          output: '',
          tokenUsage: { input: 0, output: 0 },
          attempts: 1,
          modelUsed: 'gpt-4.1',
          error: 'Fix generation failed',
        });
      }
      return Promise.resolve(successResult(step.id));
    });

    const engine = new WorkflowEngine(new StepExecutor(handler));
    const result = await engine.execute(BUG_FIX_WORKFLOW, makeContext());

    expect(result.state).toBe(WorkflowState.PAUSED);
    // Steps 1, 2, 3 succeed; step 4 fails (after maxRetries=3 escalation attempts)
    expect(result.stepResults).toHaveLength(4);
    expect(result.stepResults[3].status).toBe('failed');
  });
});

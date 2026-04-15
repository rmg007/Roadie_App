import { describe, it, expect, vi } from 'vitest';

// Mock vscode so the module can be imported in test environments
vi.mock('vscode', () => ({
  window: { createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn(), show: vi.fn() })) },
}));

import { StepExecutor, type StepHandlerFn } from './step-executor';
import type { WorkflowStep, WorkflowContext, StepResult } from '../types';

// ---- Helpers ----

function makeStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: 'test-step',
    name: 'Test Step',
    type: 'sequential',
    agentRole: 'fixer',
    modelTier: 'free',
    toolScope: 'implementation',
    promptTemplate: 'Fix the bug in {file}',
    timeoutMs: 5_000,
    maxRetries: 2, // 3 total attempts
    ...overrides,
  };
}

function makeContext(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    prompt: 'fix the login error',
    intent: { intent: 'bug_fix', confidence: 0.9, signals: ['keyword:fix'], requiresLLM: false },
    projectModel: {} as WorkflowContext['projectModel'],
    progress: { report: vi.fn(), reportMarkdown: vi.fn() },
    cancellation: { isCancelled: false, onCancelled: vi.fn() },
    ...overrides,
  };
}

function successResult(stepId = 'test-step'): StepResult {
  return {
    stepId,
    status: 'success',
    output: 'Fixed successfully',
    tokenUsage: { input: 100, output: 50 },
    attempts: 1,
    modelUsed: 'gpt-4.1',
  };
}

function failResult(stepId = 'test-step', error = 'Test failed'): StepResult {
  return {
    stepId,
    status: 'failed',
    output: '',
    tokenUsage: { input: 100, output: 50 },
    attempts: 1,
    modelUsed: 'gpt-4.1',
    error,
  };
}

// ---- Tests ----

describe('StepExecutor', () => {
  it('returns success on first attempt', async () => {
    const handler: StepHandlerFn = vi.fn().mockResolvedValue(successResult());
    const executor = new StepExecutor(handler);
    const result = await executor.executeStep(makeStep(), makeContext());

    expect(result.status).toBe('success');
    expect(result.attempts).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds on attempt 2', async () => {
    const handler: StepHandlerFn = vi.fn()
      .mockResolvedValueOnce(failResult())
      .mockResolvedValueOnce(successResult());
    const executor = new StepExecutor(handler);
    const result = await executor.executeStep(makeStep(), makeContext());

    expect(result.status).toBe('success');
    expect(result.attempts).toBe(2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('passes previous error to subsequent attempts', async () => {
    const handler: StepHandlerFn = vi.fn()
      .mockResolvedValueOnce(failResult('test-step', 'SyntaxError in output'))
      .mockResolvedValueOnce(successResult());
    const executor = new StepExecutor(handler);
    await executor.executeStep(makeStep(), makeContext());

    // Second call should receive the error from first attempt
    const secondCall = (handler as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCall[2].previousError).toBe('SyntaxError in output');
  });

  it('truncates very large previous errors before retrying', async () => {
    const longError = 'x'.repeat(10_000);
    const handler: StepHandlerFn = vi.fn()
      .mockResolvedValueOnce(failResult('test-step', longError))
      .mockResolvedValueOnce(successResult());
    const executor = new StepExecutor(handler);
    await executor.executeStep(makeStep(), makeContext());

    const secondCall = (handler as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCall[2].previousError).toHaveLength(2000);
    expect(secondCall[2].previousError).toBe(longError.slice(0, 2000));
  });

  it('escalates tier on attempt 3', async () => {
    const handler: StepHandlerFn = vi.fn()
      .mockResolvedValueOnce(failResult())
      .mockResolvedValueOnce(failResult())
      .mockResolvedValueOnce(successResult());
    const executor = new StepExecutor(handler);
    await executor.executeStep(makeStep({ modelTier: 'free' }), makeContext());

    // Attempt 3 should use escalated tier (free -> standard)
    const thirdCall = (handler as ReturnType<typeof vi.fn>).mock.calls[2];
    expect(thirdCall[2].tier).toBe('standard');
  });

  it('returns failed after maxRetries+1 attempts exhausted', async () => {
    const handler: StepHandlerFn = vi.fn().mockResolvedValue(failResult());
    const executor = new StepExecutor(handler);
    const result = await executor.executeStep(makeStep({ maxRetries: 2 }), makeContext());

    expect(result.status).toBe('failed');
    expect(result.attempts).toBe(3); // maxRetries(2) + 1
    expect(result.error).toContain('failed after 3 attempts');
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('enforces step timeout', async () => {
    const handler: StepHandlerFn = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(successResult()), 10_000)),
    );
    const executor = new StepExecutor(handler);
    const result = await executor.executeStep(
      makeStep({ timeoutMs: 50, maxRetries: 0 }),
      makeContext(),
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('timed out');
  });

  it('returns cancelled when cancellation is requested', async () => {
    const handler: StepHandlerFn = vi.fn().mockResolvedValue(successResult());
    const executor = new StepExecutor(handler);
    const ctx = makeContext({
      cancellation: { isCancelled: true, onCancelled: vi.fn() },
    });

    const result = await executor.executeStep(makeStep(), ctx);
    expect(result.status).toBe('cancelled');
    expect(handler).not.toHaveBeenCalled();
  });

  it('escalates to two tiers up on attempt 5 (free → premium)', async () => {
    const handler: StepHandlerFn = vi.fn()
      .mockResolvedValueOnce(failResult())
      .mockResolvedValueOnce(failResult())
      .mockResolvedValueOnce(failResult())
      .mockResolvedValueOnce(failResult())
      .mockResolvedValueOnce(successResult());
    const executor = new StepExecutor(handler);
    await executor.executeStep(makeStep({ modelTier: 'free', maxRetries: 5 }), makeContext());

    // Attempt 5 should use premium (two tiers above free)
    const fifthCall = (handler as ReturnType<typeof vi.fn>).mock.calls[4];
    expect(fifthCall[2].tier).toBe('premium');
    // Attempt 3 should still be standard (one tier above free)
    const thirdCall = (handler as ReturnType<typeof vi.fn>).mock.calls[2];
    expect(thirdCall[2].tier).toBe('standard');
  });

  it('uses original tier for attempts 1 and 2', async () => {
    const handler: StepHandlerFn = vi.fn()
      .mockResolvedValueOnce(failResult())
      .mockResolvedValueOnce(successResult());
    const executor = new StepExecutor(handler);
    await executor.executeStep(makeStep({ modelTier: 'free' }), makeContext());

    expect((handler as ReturnType<typeof vi.fn>).mock.calls[0][2].tier).toBe('free');
    expect((handler as ReturnType<typeof vi.fn>).mock.calls[1][2].tier).toBe('free');
  });

  it('handles handler throwing an exception', async () => {
    const handler: StepHandlerFn = vi.fn()
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce(successResult());
    const executor = new StepExecutor(handler);
    const result = await executor.executeStep(makeStep(), makeContext());

    expect(result.status).toBe('success');
    expect(result.attempts).toBe(2);
  });
});

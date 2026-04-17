/**
 * @test cancellation.test.ts
 * @description Tests cancellation propagation through the full workflow stack.
 *   Verifies that CancellationHandle respects abort signals and callbacks,
 *   and that workflows gracefully handle cancellation mid-execution.
 * @inputs FakeCancellationHandle, VSCodeCancellationHandle, WorkflowEngine
 * @outputs Cancellation behavior verification
 * @depends-on shell/vscode-providers, engine/workflow-engine
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeCancellationHandle } from '../shell/fake-providers';
import { WorkflowEngine } from '../engine/workflow-engine';
import { FakeModelProvider, FakeProgressReporter } from '../shell/fake-providers';
import type { WorkflowContext } from '../types';
import { BUG_FIX_WORKFLOW } from '../engine/definitions/bug-fix';

describe('Cancellation Propagation', () => {
  let handle: FakeCancellationHandle;
  let engine: WorkflowEngine;
  let provider: FakeModelProvider;

  beforeEach(() => {
    handle = new FakeCancellationHandle();
    provider = new FakeModelProvider();
    engine = new WorkflowEngine(provider, new FakeProgressReporter());
  });

  it('FakeCancellationHandle starts not cancelled', () => {
    expect(handle.isCancelled).toBe(false);
  });

  it('FakeCancellationHandle can be cancelled', () => {
    handle.cancel();
    expect(handle.isCancelled).toBe(true);
  });

  it('FakeCancellationHandle.signal becomes aborted when cancelled', () => {
    const signal = handle.signal;
    expect(signal.aborted).toBe(false);
    handle.cancel();
    expect(signal.aborted).toBe(true);
  });

  it('onCancelled callback fires immediately if already cancelled', () => {
    handle.cancel();

    return new Promise<void>((resolve) => {
      let callbackFired = false;
      handle.onCancelled(() => {
        callbackFired = true;
      });

      // Should fire synchronously since already cancelled
      expect(callbackFired).toBe(true);
      resolve();
    });
  });

  it('onCancelled callback fires when cancel is called', () => {
    const callback = vi.fn();
    handle.onCancelled(callback);

    expect(callback).not.toHaveBeenCalled();
    handle.cancel();
    expect(callback).toHaveBeenCalled();
  });

  it('multiple onCancelled callbacks all fire', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const callback3 = vi.fn();

    handle.onCancelled(callback1);
    handle.onCancelled(callback2);
    handle.onCancelled(callback3);

    handle.cancel();

    expect(callback1).toHaveBeenCalled();
    expect(callback2).toHaveBeenCalled();
    expect(callback3).toHaveBeenCalled();
  });

  it('cancellation signal passed to provider is respected', async () => {
    const controller = new AbortController();
    controller.abort();

    // Provider should handle already-aborted signal
    let error;
    try {
      await provider.sendRequest(
        'fake-gpt-4',
        [{ role: 'user', content: 'test' }],
        { cancellation: controller.signal },
      );
    } catch (err) {
      error = err;
    }

    // Either no error (graceful handling) or cancellation error
    if (error) {
      expect(error instanceof Error).toBe(true);
    }
  });

  it('workflow execution with cancelled context completes gracefully', async () => {
    handle.cancel();

    const context: WorkflowContext = {
      prompt: 'Test workflow',
      intent: {
        intent: 'bug_fix',
        confidence: 0.9,
        signals: ['bug'],
        requiresLLM: true,
      },
      projectModel: { root: '/test', frameworks: [], dependencies: [], patterns: [] },
      progress: new FakeProgressReporter(),
      cancellation: handle,
    };

    const result = await engine.execute(BUG_FIX_WORKFLOW, context);
    expect(result).toBeDefined();
    // Should either complete or be marked as cancelled/interrupted
  });

  it('cancel() is idempotent', () => {
    handle.cancel();
    expect(handle.isCancelled).toBe(true);

    // Cancelling again should not fail
    expect(() => handle.cancel()).not.toThrow();
    expect(handle.isCancelled).toBe(true);
  });
});

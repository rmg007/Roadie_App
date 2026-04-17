/**
 * @test cancellation.test.ts (A6)
 * @description Property-based test using fast-check that verifies:
 *   - Async command handlers respect CancellationToken / AbortSignal
 *   - No side effects occur after cancellation within 50ms
 * @depends-on fast-check, shell/fake-providers
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { FakeCancellationHandle } from '../fake-providers';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Simulates an async command handler that:
 * 1. Checks the cancellation token at start
 * 2. Delays by `delayMs`
 * 3. Records a side-effect if not cancelled
 */
async function simulateCommandHandler(
  handle: FakeCancellationHandle,
  delayMs: number,
  sideEffectRecorder: { fired: boolean },
): Promise<void> {
  if (handle.isCancelled) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!handle.isCancelled) {
        sideEffectRecorder.fired = true;
      }
      resolve();
    }, delayMs);

    handle.onCancelled(() => {
      clearTimeout(timer);
      resolve();
    });

    void reject; // ensure no unhandled rejection lint warning
  });
}

/**
 * Simulates a command that checks the AbortSignal from the handle.
 */
async function simulateAbortSignalHandler(
  handle: FakeCancellationHandle,
  delayMs: number,
  sideEffectRecorder: { fired: boolean },
): Promise<void> {
  const signal = handle.signal;
  if (signal.aborted) return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!signal.aborted) {
        sideEffectRecorder.fired = true;
      }
      resolve();
    }, delayMs);

    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('A6 — Cancellation discipline (property-based)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no side effects when cancel is called before handler starts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 200 }),
        async (delayMs) => {
          const handle = new FakeCancellationHandle();
          const recorder = { fired: false };

          handle.cancel(); // cancel BEFORE handler starts
          await simulateCommandHandler(handle, delayMs, recorder);

          expect(recorder.fired).toBe(false);
        },
      ),
      { numRuns: 50, verbose: false },
    );
  });

  it('no side effects when cancel is called within 50ms during handler execution', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 60, max: 200 }),   // handler delay > cancel window
        fc.integer({ min: 5,  max: 49 }),    // cancel before handler finishes
        async (handlerDelayMs, cancelAfterMs) => {
          const handle = new FakeCancellationHandle();
          const recorder = { fired: false };

          // Cancel within 50ms while handler is running
          const cancelTimer = setTimeout(() => handle.cancel(), cancelAfterMs);

          await simulateCommandHandler(handle, handlerDelayMs, recorder);
          clearTimeout(cancelTimer);

          expect(recorder.fired).toBe(false);
        },
      ),
      { numRuns: 30, verbose: false },
    );
  });

  it('side effect fires when handler completes before cancellation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),   // fast handler
        async (handlerDelayMs) => {
          const handle = new FakeCancellationHandle();
          const recorder = { fired: false };

          // Let the handler complete fully (never cancel)
          await simulateCommandHandler(handle, handlerDelayMs, recorder);

          expect(recorder.fired).toBe(true);
        },
      ),
      { numRuns: 30, verbose: false },
    );
  });

  it('AbortSignal-based handler: no side effects when cancelled within 50ms', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 60, max: 200 }),
        fc.integer({ min: 5,  max: 49 }),
        async (handlerDelayMs, cancelAfterMs) => {
          const handle = new FakeCancellationHandle();
          const recorder = { fired: false };

          const cancelTimer = setTimeout(() => handle.cancel(), cancelAfterMs);
          await simulateAbortSignalHandler(handle, handlerDelayMs, recorder);
          clearTimeout(cancelTimer);

          expect(recorder.fired).toBe(false);
        },
      ),
      { numRuns: 30, verbose: false },
    );
  });

  it('FakeCancellationHandle is idempotent — cancel() many times is safe', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (cancelCount) => {
          const handle = new FakeCancellationHandle();
          for (let i = 0; i < cancelCount; i++) {
            expect(() => handle.cancel()).not.toThrow();
          }
          expect(handle.isCancelled).toBe(true);
          expect(handle.signal.aborted).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('callbacks registered before cancel all fire exactly once', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        (callbackCount) => {
          const handle = new FakeCancellationHandle();
          const fired: number[] = [];

          for (let i = 0; i < callbackCount; i++) {
            const idx = i;
            handle.onCancelled(() => fired.push(idx));
          }

          handle.cancel();
          // Each callback fired exactly once, in registration order
          expect(fired).toHaveLength(callbackCount);
          expect(fired).toEqual(Array.from({ length: callbackCount }, (_, i) => i));
        },
      ),
      { numRuns: 50 },
    );
  });
});

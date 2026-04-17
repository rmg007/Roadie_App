/**
 * @test debounce.test.ts (F4)
 * @description Property tests for FileWatcherManager debounce behaviour.
 *   Uses fake timers so no real wall-clock time is needed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { FileWatcherManager } from '../file-watcher-manager';

afterEach(() => {
  vi.useRealTimers();
});

describe('F4 — File watcher debounce (property tests)', () => {
  it('handler is called exactly once for a burst of N events within the debounce window', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),  // number of distinct file paths
        fc.integer({ min: 10, max: 200 }), // debounce window ms
        (fileCount, debounceMs) => {
          vi.useFakeTimers();
          let handlerCalls = 0;
          const watcher = new FileWatcherManager({ debounceMs });
          watcher.onBatch(() => { handlerCalls++; });
          watcher.start();

          // Emit one event per distinct path — all within the debounce window
          for (let i = 0; i < fileCount; i++) {
            watcher.handleFileEvent(`/workspace/file${i}.ts`, 'change');
          }

          // Advance past the debounce window — handler should fire exactly once
          vi.advanceTimersByTime(debounceMs + 1);

          watcher.dispose();
          vi.useRealTimers();

          // Regardless of how many files changed, handler fires exactly once
          // (all events are collapsed into one batch by the debounce timer)
          expect(handlerCalls).toBe(1);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('handler fires once even when the same file is updated multiple times in the window', () => {
    vi.useFakeTimers();
    let handlerCalls = 0;
    const debounceMs = 100;
    const watcher = new FileWatcherManager({ debounceMs });
    watcher.onBatch(() => { handlerCalls++; });
    watcher.start();

    // Same file, 10 rapid changes
    for (let i = 0; i < 10; i++) {
      watcher.handleFileEvent('/workspace/src/index.ts', 'change');
    }

    vi.advanceTimersByTime(debounceMs + 1);
    watcher.dispose();

    expect(handlerCalls).toBe(1);
  });

  it('debounce does not miss events — batch contains the last event in a burst', () => {
    vi.useFakeTimers();
    const received: string[] = [];
    const debounceMs = 50;
    const watcher = new FileWatcherManager({ debounceMs });
    watcher.onBatch((events) => {
      for (const e of events) {
        if ('filePath' in e) received.push(e.filePath);
      }
    });
    watcher.start();

    watcher.handleFileEvent('/workspace/a.ts', 'change');
    watcher.handleFileEvent('/workspace/b.ts', 'change');

    vi.advanceTimersByTime(debounceMs + 1);
    watcher.dispose();

    // Both distinct files must appear in the dispatched batch
    expect(received).toContain('/workspace/a.ts');
    expect(received).toContain('/workspace/b.ts');
  });

  it('timer is reset when a new event arrives before debounce fires', () => {
    vi.useFakeTimers();
    let handlerCalls = 0;
    const debounceMs = 100;
    const watcher = new FileWatcherManager({ debounceMs });
    watcher.onBatch(() => { handlerCalls++; });
    watcher.start();

    watcher.handleFileEvent('/workspace/a.ts', 'change');
    // Advance only 80 ms — timer should NOT have fired yet
    vi.advanceTimersByTime(80);
    expect(handlerCalls).toBe(0);

    // New event resets the debounce window
    watcher.handleFileEvent('/workspace/b.ts', 'change');
    vi.advanceTimersByTime(80); // only 80 ms since last reset → still not fired
    expect(handlerCalls).toBe(0);

    vi.advanceTimersByTime(21); // total 101 ms since last event → fires
    expect(handlerCalls).toBe(1);

    watcher.dispose();
  });
});

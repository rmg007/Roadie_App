import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileWatcherManager } from './file-watcher-manager';
import type { BatchPayload, FileChangeEvent, FullRescanEvent } from './file-watcher-manager';

// =====================================================================
// Helpers
// =====================================================================

function createManager(overrides?: { debounceMs?: number; maxBatchSize?: number }) {
  const manager = new FileWatcherManager({
    debounceMs: overrides?.debounceMs ?? 500,
    maxBatchSize: overrides?.maxBatchSize ?? 1000,
  });
  manager.start();
  return manager;
}

function collectBatches(manager: FileWatcherManager): BatchPayload[] {
  const batches: BatchPayload[] = [];
  manager.onBatch((events) => batches.push(events));
  return batches;
}

// =====================================================================
// Tests
// =====================================================================

describe('FileWatcherManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------
  // Debouncing
  // -------------------------------------------------------------------

  describe('debouncing', () => {
    it('collects multiple rapid events into a single batch', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('src/a.ts', 'change');
      manager.handleFileEvent('src/b.ts', 'change');
      manager.handleFileEvent('src/c.ts', 'create');

      expect(batches).toHaveLength(0);

      vi.advanceTimersByTime(600);

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(3);

      manager.dispose();
    });

    it('does not emit before debounce period expires', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('src/a.ts', 'change');

      vi.advanceTimersByTime(300);
      expect(batches).toHaveLength(0);

      vi.advanceTimersByTime(300);
      expect(batches).toHaveLength(1);

      manager.dispose();
    });

    it('resets debounce timer on each new event', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('src/a.ts', 'change');
      vi.advanceTimersByTime(400);

      // Another event arrives before the 500ms window closes
      manager.handleFileEvent('src/b.ts', 'change');
      vi.advanceTimersByTime(400);

      // Still nothing — timer was reset
      expect(batches).toHaveLength(0);

      vi.advanceTimersByTime(200);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);

      manager.dispose();
    });
  });

  // -------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------

  describe('deduplication', () => {
    it('keeps only the last event for the same file', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('src/a.ts', 'create');
      manager.handleFileEvent('src/a.ts', 'change');
      manager.handleFileEvent('src/a.ts', 'change');

      vi.advanceTimersByTime(600);

      expect(batches).toHaveLength(1);
      // Only one event for src/a.ts
      const events = batches[0] as FileChangeEvent[];
      expect(events).toHaveLength(1);
      expect(events[0].filePath).toBe('src/a.ts');
      expect(events[0].eventType).toBe('change');

      manager.dispose();
    });
  });

  // -------------------------------------------------------------------
  // Add + delete cancellation
  // -------------------------------------------------------------------

  describe('add+delete cancellation', () => {
    it('cancels out create followed by delete', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('src/temp.ts', 'create');
      manager.handleFileEvent('src/temp.ts', 'delete');

      vi.advanceTimersByTime(600);

      // Batch should be empty (no events), so processBatch returns early
      expect(batches).toHaveLength(0);

      manager.dispose();
    });

    it('cancels out delete followed by create', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('src/old.ts', 'delete');
      manager.handleFileEvent('src/old.ts', 'create');

      vi.advanceTimersByTime(600);

      expect(batches).toHaveLength(0);

      manager.dispose();
    });

    it('does not cancel create followed by change', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('src/a.ts', 'create');
      manager.handleFileEvent('src/a.ts', 'change');

      vi.advanceTimersByTime(600);

      expect(batches).toHaveLength(1);
      const events = batches[0] as FileChangeEvent[];
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('change');

      manager.dispose();
    });
  });

  // -------------------------------------------------------------------
  // Ignored paths
  // -------------------------------------------------------------------

  describe('ignored paths', () => {
    it('filters out node_modules events', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('node_modules/lodash/index.js', 'change');
      manager.handleFileEvent('src/index.ts', 'change');

      vi.advanceTimersByTime(600);

      expect(batches).toHaveLength(1);
      const events = batches[0] as FileChangeEvent[];
      expect(events).toHaveLength(1);
      expect(events[0].filePath).toBe('src/index.ts');

      manager.dispose();
    });

    it('filters out .git events', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('.git/HEAD', 'change');

      vi.advanceTimersByTime(600);

      expect(batches).toHaveLength(0);

      manager.dispose();
    });

    it('filters out dist/ events', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('dist/bundle.js', 'create');

      vi.advanceTimersByTime(600);

      expect(batches).toHaveLength(0);

      manager.dispose();
    });
  });

  // -------------------------------------------------------------------
  // Classification in batches
  // -------------------------------------------------------------------

  describe('classification', () => {
    it('classifies dependency changes as HIGH priority', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('package.json', 'change');

      vi.advanceTimersByTime(600);

      const events = batches[0] as FileChangeEvent[];
      expect(events[0].classifiedAs).toBe('DEPENDENCY_CHANGE');
      expect(events[0].priority).toBe('HIGH');
      expect(events[0].triggers).toContain('dependency-updater');

      manager.dispose();
    });

    it('classifies config changes as MEDIUM priority', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('tsconfig.json', 'change');

      vi.advanceTimersByTime(600);

      const events = batches[0] as FileChangeEvent[];
      expect(events[0].classifiedAs).toBe('CONFIG_CHANGE');
      expect(events[0].priority).toBe('MEDIUM');

      manager.dispose();
    });

    it('sorts batch by priority (HIGH before MEDIUM before LOW)', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('src/index.ts', 'create'); // LOW (SOURCE_ADDITION)
      manager.handleFileEvent('tsconfig.json', 'change'); // MEDIUM
      manager.handleFileEvent('package.json', 'change'); // HIGH

      vi.advanceTimersByTime(600);

      const events = batches[0] as FileChangeEvent[];
      expect(events[0].priority).toBe('HIGH');
      expect(events[1].priority).toBe('MEDIUM');
      expect(events[2].priority).toBe('LOW');

      manager.dispose();
    });
  });

  // -------------------------------------------------------------------
  // Full rescan on large batch
  // -------------------------------------------------------------------

  describe('full rescan', () => {
    it('emits FULL_RESCAN when batch exceeds maxBatchSize', () => {
      const manager = createManager({ maxBatchSize: 5 });
      const batches = collectBatches(manager);

      for (let i = 0; i < 10; i++) {
        manager.handleFileEvent(`src/file-${i}.ts`, 'create');
      }

      vi.advanceTimersByTime(600);

      expect(batches).toHaveLength(1);
      const payload = batches[0] as [FullRescanEvent];
      expect(payload[0].type).toBe('FULL_RESCAN');
      expect(payload[0].eventCount).toBe(10);

      manager.dispose();
    });

    it('does not emit FULL_RESCAN at exactly maxBatchSize', () => {
      const manager = createManager({ maxBatchSize: 5 });
      const batches = collectBatches(manager);

      for (let i = 0; i < 5; i++) {
        manager.handleFileEvent(`src/file-${i}.ts`, 'create');
      }

      vi.advanceTimersByTime(600);

      expect(batches).toHaveLength(1);
      const events = batches[0] as FileChangeEvent[];
      expect(events).toHaveLength(5);
      // Should be regular events, not FULL_RESCAN
      expect((events[0] as unknown as FullRescanEvent).type).not.toBe('FULL_RESCAN');

      manager.dispose();
    });

    it('emits FULL_RESCAN immediately when pending event count overflows', () => {
      const manager = createManager({ maxBatchSize: 1000 });
      const batches = collectBatches(manager);

      for (let i = 0; i < 2001; i++) {
        manager.handleFileEvent(`src/file-${i}.ts`, 'change');
      }

      expect(batches).toHaveLength(1);
      const payload = batches[0] as [FullRescanEvent];
      expect(payload[0].type).toBe('FULL_RESCAN');
      expect(payload[0].eventCount).toBe(2001);
      expect(manager.getStatus().pendingCount).toBe(0);

      manager.dispose();
    });
  });

  // -------------------------------------------------------------------
  // flush()
  // -------------------------------------------------------------------

  describe('flush()', () => {
    it('processes pending events immediately', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('src/a.ts', 'change');
      manager.flush();

      expect(batches).toHaveLength(1);

      // Advancing time should not produce a second batch
      vi.advanceTimersByTime(600);
      expect(batches).toHaveLength(1);

      manager.dispose();
    });
  });

  // -------------------------------------------------------------------
  // Handler subscription / disposal
  // -------------------------------------------------------------------

  describe('onBatch subscription', () => {
    it('supports multiple handlers', () => {
      const manager = createManager();
      let callCount = 0;

      manager.onBatch(() => callCount++);
      manager.onBatch(() => callCount++);

      manager.handleFileEvent('src/a.ts', 'change');
      vi.advanceTimersByTime(600);

      expect(callCount).toBe(2);

      manager.dispose();
    });

    it('returns a Disposable that removes the handler', () => {
      const manager = createManager();
      let called = false;

      const sub = manager.onBatch(() => { called = true; });
      sub.dispose();

      manager.handleFileEvent('src/a.ts', 'change');
      vi.advanceTimersByTime(600);

      expect(called).toBe(false);

      manager.dispose();
    });
  });

  // -------------------------------------------------------------------
  // Status reporting
  // -------------------------------------------------------------------

  describe('getStatus()', () => {
    it('reports correct status', () => {
      const manager = createManager();

      expect(manager.getStatus()).toEqual({
        watching: true,
        pendingCount: 0,
        totalEvents: 0,
      });

      manager.handleFileEvent('src/a.ts', 'change');
      manager.handleFileEvent('src/b.ts', 'create');

      expect(manager.getStatus()).toEqual({
        watching: true,
        pendingCount: 2,
        totalEvents: 2,
      });

      manager.flush();

      expect(manager.getStatus()).toEqual({
        watching: true,
        pendingCount: 0,
        totalEvents: 2,
      });

      manager.dispose();
    });
  });

  // -------------------------------------------------------------------
  // Lifecycle: start / stop / dispose
  // -------------------------------------------------------------------

  describe('lifecycle', () => {
    it('ignores events when not started', () => {
      const manager = new FileWatcherManager({ debounceMs: 500, maxBatchSize: 1000 });
      const batches = collectBatches(manager);
      // NOT calling start()

      manager.handleFileEvent('src/a.ts', 'change');
      vi.advanceTimersByTime(600);

      expect(batches).toHaveLength(0);
      expect(manager.isWatching()).toBe(false);

      manager.dispose();
    });

    it('stop() flushes pending and stops accepting events', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      manager.handleFileEvent('src/a.ts', 'change');
      manager.stop();

      // Pending event should have been flushed
      expect(batches).toHaveLength(1);

      // New events should be ignored
      manager.handleFileEvent('src/b.ts', 'change');
      vi.advanceTimersByTime(600);

      expect(batches).toHaveLength(1);
      expect(manager.isWatching()).toBe(false);
    });

    it('dispose() clears all state', () => {
      const manager = createManager();

      manager.handleFileEvent('src/a.ts', 'change');
      manager.dispose();

      const status = manager.getStatus();
      expect(status.watching).toBe(false);
      expect(status.pendingCount).toBe(0);
      expect(status.totalEvents).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // Event timestamp
  // -------------------------------------------------------------------

  describe('event timestamps', () => {
    it('attaches a timestamp to each classified event', () => {
      const manager = createManager();
      const batches = collectBatches(manager);

      const before = new Date();
      manager.handleFileEvent('package.json', 'change');
      vi.advanceTimersByTime(600);

      const events = batches[0] as FileChangeEvent[];
      expect(events[0].timestamp).toBeInstanceOf(Date);
      expect(events[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());

      manager.dispose();
    });
  });
});

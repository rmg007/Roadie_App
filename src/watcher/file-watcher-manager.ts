/**
 * @module file-watcher-manager
 * @description Manages workspace file change events with debouncing,
 *   deduplication, classification, and batched dispatch to handlers.
 *   Accepts dependencies via constructor for testability.
 * @inputs Raw file system events (path + event type)
 * @outputs Batched, classified FileChangeEvent arrays
 * @depends-on change-classifier
 * @depended-on-by Extension activation, persistent project model
 */

import type { ChangeType, Disposable } from '../types';
import { classifyChange, isIgnoredPath } from './change-classifier';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FileWatcherConfig {
  /** Milliseconds to wait before flushing pending events (default: 500) */
  debounceMs: number;
  /** Maximum batch size before triggering a full rescan (default: 1000) */
  maxBatchSize: number;
}

const MAX_PENDING_EVENTS = 2000;

export const DEFAULT_CONFIG: FileWatcherConfig = {
  debounceMs: 500,
  maxBatchSize: 1000,
};

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface FileChangeEvent {
  filePath: string;
  eventType: 'create' | 'change' | 'delete';
  classifiedAs: ChangeType;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  triggers: string[];
  timestamp: Date;
}

/** Sentinel event indicating the batch was too large for individual dispatch. */
export interface FullRescanEvent {
  type: 'FULL_RESCAN';
  eventCount: number;
  timestamp: Date;
}

export type BatchPayload = FileChangeEvent[] | [FullRescanEvent];

export type BatchHandler = (events: BatchPayload) => void;

// ---------------------------------------------------------------------------
// Pending event record (internal)
// ---------------------------------------------------------------------------

interface PendingEvent {
  eventType: 'create' | 'change' | 'delete';
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// FileWatcherManager
// ---------------------------------------------------------------------------

export class FileWatcherManager {
  private pending: Map<string, PendingEvent> = new Map();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: BatchHandler[] = [];
  private watching = false;
  private totalEvents = 0;
  private config: FileWatcherConfig;

  constructor(config?: Partial<FileWatcherConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Process a raw file event. Ignored paths are dropped immediately.
   * Events are collected and debounced before dispatch.
   */
  handleFileEvent(filePath: string, eventType: 'create' | 'change' | 'delete'): void {
    if (!this.watching) {
      return;
    }

    if (isIgnoredPath(filePath)) {
      return;
    }

    this.totalEvents++;

    const existing = this.pending.get(filePath);

    // Add+delete cancellation: if we previously saw a 'create' and now
    // receive a 'delete' (or vice-versa), the net effect is nothing.
    if (existing) {
      const cancels =
        (existing.eventType === 'create' && eventType === 'delete') ||
        (existing.eventType === 'delete' && eventType === 'create');

      if (cancels) {
        this.pending.delete(filePath);
        this.resetDebounceTimer();
        return;
      }
    }

    // Deduplication: keep only the latest event per file path.
    this.pending.set(filePath, { eventType, timestamp: new Date() });

    if (this.pending.size > MAX_PENDING_EVENTS) {
      const overflowCount = this.pending.size;
      this.clearDebounceTimer();
      const rescanEvent: FullRescanEvent = {
        type: 'FULL_RESCAN',
        eventCount: overflowCount,
        timestamp: new Date(),
      };
      this.pending.clear();
      for (const handler of this.handlers) {
        handler([rescanEvent]);
      }
      return;
    }

    this.resetDebounceTimer();
  }

  /**
   * Subscribe to batched, classified events.
   * Returns a Disposable for unsubscribing.
   */
  onBatch(handler: BatchHandler): Disposable {
    this.handlers.push(handler);
    return {
      dispose: () => {
        const index = this.handlers.indexOf(handler);
        if (index !== -1) {
          this.handlers.splice(index, 1);
        }
      },
    };
  }

  /**
   * Force-flush pending events immediately, bypassing the debounce timer.
   */
  flush(): void {
    this.clearDebounceTimer();
    this.processBatch();
  }

  /** Whether the watcher is currently active. */
  isWatching(): boolean {
    return this.watching;
  }

  /** Status snapshot for diagnostics. */
  getStatus(): { watching: boolean; pendingCount: number; totalEvents: number } {
    return {
      watching: this.watching,
      pendingCount: this.pending.size,
      totalEvents: this.totalEvents,
    };
  }

  /** Start accepting events. */
  start(): void {
    this.watching = true;
  }

  /** Stop accepting events and flush pending. */
  stop(): void {
    this.watching = false;
    this.flush();
  }

  /** Full teardown: stop, clear handlers. */
  dispose(): void {
    this.stop();
    this.handlers = [];
    this.pending.clear();
    this.totalEvents = 0;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private resetDebounceTimer(): void {
    this.clearDebounceTimer();
    this.debounceTimer = setTimeout(() => {
      this.processBatch();
    }, this.config.debounceMs);
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private processBatch(): void {
    if (this.pending.size === 0) {
      return;
    }

    // If the batch exceeds maxBatchSize, emit a full-rescan sentinel.
    if (this.pending.size > this.config.maxBatchSize) {
      const rescanEvent: FullRescanEvent = {
        type: 'FULL_RESCAN',
        eventCount: this.pending.size,
        timestamp: new Date(),
      };
      this.pending.clear();
      for (const handler of this.handlers) {
        handler([rescanEvent]);
      }
      return;
    }

    // Classify and build the event batch.
    const events: FileChangeEvent[] = [];
    for (const [filePath, { eventType, timestamp }] of this.pending) {
      const classified = classifyChange(filePath, eventType);
      events.push({
        filePath,
        eventType,
        classifiedAs: classified.type,
        priority: classified.priority,
        triggers: classified.triggers,
        timestamp,
      });
    }

    this.pending.clear();

    // Sort by priority: HIGH first, then MEDIUM, then LOW.
    const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    events.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));

    for (const handler of this.handlers) {
      handler(events);
    }
  }
}

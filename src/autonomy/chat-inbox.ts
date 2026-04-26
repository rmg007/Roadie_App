/**
 * @module chat-inbox
 * @description Non-blocking message queue for Roadie chat messages.
 *   User messages are enqueued while a workflow is running; Roadie
 *   processes them in order and emits a notification when each completes.
 *   Satisfies 4.7: chat inbox — non-blocking user messages queued;
 *   Roadie reports when work is done via an event callback.
 *
 * @outputs ChatInbox — enqueue(), drain(), onComplete callback
 * @depends-on types, Logger
 * @depended-on-by autonomy-loop, index.ts (MCP notification hook)
 */

import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';

// ---- Types ----

export interface InboxMessage {
  id: string;
  message: string;
  sessionId?: string;
  enqueuedAt: Date;
}

export interface InboxCompletionEvent {
  messageId: string;
  message: string;
  summary: string;
  filesChanged: string[];
  completedAt: Date;
  durationMs: number;
}

export type CompletionHandler = (event: InboxCompletionEvent) => void;
export type MessageProcessor = (message: InboxMessage) => Promise<{ summary: string; filesChanged: string[] }>;

// ---- ChatInbox ----

/**
 * FIFO message queue that processes one message at a time.
 * While a message is processing, new messages are buffered.
 * When processing finishes, onComplete is called and the next message starts.
 */
export class ChatInbox {
  private queue: InboxMessage[] = [];
  private processing = false;
  private completionHandlers: CompletionHandler[] = [];
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? STUB_LOGGER;
  }

  /**
   * Register a handler called whenever a message finishes processing.
   * Attach this to MCP notification dispatch.
   */
  onComplete(handler: CompletionHandler): void {
    this.completionHandlers.push(handler);
  }

  /**
   * Enqueue a user message. If nothing is processing, starts immediately.
   * Returns the message ID for tracking.
   */
  enqueue(message: string, sessionId?: string): string {
    const id = `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entry: InboxMessage = { id, message, enqueuedAt: new Date(), ...(sessionId !== undefined ? { sessionId } : {}) };
    this.queue.push(entry);
    this.logger.info(`[ChatInbox] Enqueued message ${id} (queue depth: ${this.queue.length})`);
    void this.drain();
    return id;
  }

  /**
   * Current queue depth (messages waiting, not counting the one processing).
   */
  get depth(): number {
    return this.queue.length;
  }

  /**
   * True if a message is currently being processed.
   */
  get isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Process queued messages using the provided processor function.
   * Called automatically on enqueue; can also be called manually to restart after error.
   */
  async drain(processor?: MessageProcessor): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    if (!processor && !this._defaultProcessor) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) break;
      const startTime = Date.now();
      this.logger.info(`[ChatInbox] Processing message ${entry.id}: "${entry.message.substring(0, 80)}..."`);

      try {
        const proc = processor ?? this._defaultProcessor;
        if (!proc) break;
        const result = await proc(entry);
        const event: InboxCompletionEvent = {
          messageId: entry.id,
          message: entry.message,
          summary: result.summary,
          filesChanged: result.filesChanged,
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        };

        this.logger.info(`[ChatInbox] Completed message ${entry.id} in ${event.durationMs}ms`);
        for (const handler of this.completionHandlers) {
          try { handler(event); } catch { /* handler errors don't stop the queue */ }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[ChatInbox] Failed to process message ${entry.id}: ${msg}`);
        // Emit a failure completion event so the host-AI is notified
        const event: InboxCompletionEvent = {
          messageId: entry.id,
          message: entry.message,
          summary: `Error processing request: ${msg}`,
          filesChanged: [],
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        };
        for (const handler of this.completionHandlers) {
          try { handler(event); } catch { /* ignore */ }
        }
      }
    }

    this.processing = false;
  }

  /**
   * Assign a default processor so `enqueue` can auto-drain without a caller-supplied processor.
   */
  setDefaultProcessor(processor: MessageProcessor): void {
    this._defaultProcessor = processor;
  }

  private _defaultProcessor?: MessageProcessor;
}

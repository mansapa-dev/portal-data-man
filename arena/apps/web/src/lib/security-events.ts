/**
 * Client-side security event batcher.
 *
 * Events are batched and sent periodically (or on demand) to avoid
 * per-event HTTP requests. Events are queued in memory with a bounded
 * size; oldest are dropped if the queue overflows (network outage scenario).
 */

export interface SecurityEvent {
  event_key: string;
  event_type: string;
  client_occurred_at?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface SecurityEventBatcherConfig {
  attemptId: string;
  examId: number;
  send: (events: SecurityEvent[]) => Promise<void>;
  /** Max batch size. Default 20. */
  maxBatchSize?: number;
  /** Max queue size before oldest are dropped. Default 100. */
  maxQueueSize?: number;
  /** Flush interval in ms. Default 10000. */
  flushIntervalMs?: number;
}

export interface SecurityEventBatcher {
  push(event: SecurityEvent): void;
  flush(): Promise<void>;
  stop(): void;
}

export function createSecurityEventBatcher(config: SecurityEventBatcherConfig): SecurityEventBatcher {
  const maxBatch = config.maxBatchSize ?? 20;
  const maxQueue = config.maxQueueSize ?? 100;
  const flushInterval = config.flushIntervalMs ?? 10_000;

  let queue: SecurityEvent[] = [];
  let flushTimer: number = 0;
  let disposed = false;
  let inFlight = false;

  const scheduleFlush = () => {
    if (disposed || flushTimer) return;
    flushTimer = window.setTimeout(() => {
      flushTimer = 0;
      void doFlush();
    }, flushInterval);
  };

  const doFlush = async () => {
    if (disposed || inFlight || queue.length === 0) return;
    inFlight = true;
    const batch = queue.splice(0, maxBatch);
    try {
      await config.send(batch);
    } catch {
      // On failure, re-queue (bounded)
      const spaceLeft = maxQueue - queue.length;
      if (spaceLeft > 0) {
        queue.unshift(...batch.slice(0, spaceLeft));
      }
    } finally {
      inFlight = false;
    }
    if (!disposed && queue.length > 0) scheduleFlush();
  };

  return {
    push(event) {
      if (disposed) return;
      if (queue.length >= maxQueue) {
        queue.shift(); // Drop oldest
      }
      queue.push(event);
      scheduleFlush();
    },
    async flush() {
      if (flushTimer) { window.clearTimeout(flushTimer); flushTimer = 0; }
      await doFlush();
    },
    stop() {
      disposed = true;
      if (flushTimer) { window.clearTimeout(flushTimer); flushTimer = 0; }
    },
  };
}

/** Generate a unique event key. */
export function makeEventKey(type: string): string {
  return `${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

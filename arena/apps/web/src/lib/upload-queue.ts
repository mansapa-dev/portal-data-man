/**
 * Segment upload queue with durable IndexedDB persistence.
 *
 * - Segments are written to IndexedDB before upload so they survive browser
 *   suspension and page reloads.
 * - When `requireDurablePersistence` is true and IndexedDB is unavailable,
 *   fails closed rather than pretending recording is durable.
 * - Failed segments are NEVER deleted from IndexedDB after retry exhaustion;
 *   they remain marked `failed: true` for controlled manual/reconnect retry.
 * - Supports bounded `flush(timeoutMs)` for clean exam finalization.
 */

export interface QueuedSegment {
  id: string;        // client-generated unique ID
  blob: Blob;
  mimeType: string;
  sequenceNumber: number;
  sessionId: string;  // recording session public ID
  examId: number;
  startedAt: string;  // ISO 8601
  endedAt: string;
  retryCount: number;
  enqueuedAt: number; // Date.now()
  failed?: boolean;
  lastError?: string;
}

export interface UploadQueueConfig {
  sessionId: string;
  examId: number;
  maxQueueSize?: number;
  maxRetries?: number;
  /** Abort a stalled PUT after this many ms and retry with backoff. Default 60000. */
  uploadTimeoutMs?: number;
  /** Random delay (0..N ms) before the first upload of a segment. Default 3000. */
  uploadStartJitterMs?: number;
  requireDurablePersistence?: boolean;
  /** Called to get presigned URL for a segment */
  requestPresignedUrl: (segment: QueuedSegment) => Promise<{
    upload_url: string;
    segment_id: number;
    /** Server already has a confirmed object for this sequence; skip the PUT. */
    already_uploaded?: boolean;
  }>;
  /** Called after successful upload to confirm with API */
  confirmUpload: (segment: QueuedSegment, segmentId: number, fileSizeBytes: number) => Promise<void>;
  /** Called when a segment exhausts retries or hits a permanent error */
  onPermanentFailure: (segment: QueuedSegment, error: Error) => void;
  /** Called when durable IndexedDB storage is unavailable */
  onStorageUnavailable?: (error: Error) => void;
  /** Called when upload status changes */
  onStatusChange?: (pending: number, uploading: boolean, failed: number) => void;
}

const DB_NAME = 'arena-recording-queue';
const DB_VERSION = 1;
const STORE_NAME = 'segments';
const MAX_RETRY_DELAYS = [2000, 5000, 10000, 20000, 30000, 60000];

export interface UploadQueue {
  enqueue(segment: Omit<QueuedSegment, 'retryCount' | 'enqueuedAt'>): Promise<void>;
  start(): Promise<boolean>;
  stop(): void;
  retryFailed(): void;
  flush(timeoutMs?: number): Promise<{ pending: number; failed: number; timedOut: boolean }>;
  readonly pendingCount: number;
  readonly failedCount: number;
}

class NonRetryableUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableUploadError';
  }
}

async function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('sessionId', 'sessionId', { unique: false });
          store.createIndex('enqueuedAt', 'enqueuedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function createUploadQueue(config: UploadQueueConfig): UploadQueue {
  const maxQueueSize = config.maxQueueSize ?? 20;
  const maxRetries = config.maxRetries ?? 5;
  const uploadTimeoutMs = config.uploadTimeoutMs ?? 60_000;
  const uploadStartJitterMs = config.uploadStartJitterMs ?? 3_000;

  let db: IDBDatabase | null = null;
  let dbChecked = false;
  let memoryQueue: QueuedSegment[] = [];
  let failedQueue: QueuedSegment[] = [];
  let uploading = false;
  let running = false;
  let processTimer = 0;
  const flushWaiters: Array<() => void> = [];

  const jitter = (baseMs: number) => baseMs + Math.floor(Math.random() * 1000);
  // Spread the first upload of each segment so 1,200 students who started at
  // the same time do not hit Object Storage in one synchronized burst.
  const initialDelay = () => uploadStartJitterMs > 0
    ? Math.floor(Math.random() * uploadStartJitterMs)
    : 0;

  const notifyStatus = () => {
    config.onStatusChange?.(memoryQueue.length, uploading, failedQueue.length);
    if (memoryQueue.length === 0 && !uploading) {
      while (flushWaiters.length > 0) {
        flushWaiters.shift()?.();
      }
    }
  };

  const scheduleProcess = (delayMs = 0) => {
    if (!running) return;
    if (processTimer) window.clearTimeout(processTimer);
    processTimer = window.setTimeout(() => {
      processTimer = 0;
      void processNext();
    }, delayMs);
  };

  const saveToDb = async (segment: QueuedSegment): Promise<boolean> => {
    if (!db) return !config.requireDurablePersistence;
    return new Promise<boolean>((resolve) => {
      try {
        const tx = db!.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(segment);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  };

  const removeFromDb = async (id: string) => {
    if (!db) return;
    return new Promise<void>((resolve) => {
      try {
        const tx = db!.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  };

  const processNext = async () => {
    if (!running || uploading || memoryQueue.length === 0) {
      notifyStatus();
      return;
    }

    const segment = memoryQueue[0]!;
    uploading = true;
    notifyStatus();

    try {
      const { upload_url, segment_id, already_uploaded } = await config.requestPresignedUrl(segment);

      // The server already holds a confirmed object for this sequence. Do not
      // overwrite evidence with a fresh PUT; just re-confirm and drain the queue.
      if (!already_uploaded) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), uploadTimeoutMs);
        let response: Response;
        try {
          response = await fetch(upload_url, {
            method: 'PUT',
            body: segment.blob,
            headers: { 'Content-Type': segment.mimeType },
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeout);
        }

        if (!response.ok) {
          if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
            throw new NonRetryableUploadError(`Upload rejected (${response.status})`);
          }
          throw new Error(`Upload failed: ${response.status}`);
        }
      }

      await config.confirmUpload(segment, segment_id, segment.blob.size);

      // Success — remove from active queue and IndexedDB
      memoryQueue.shift();
      await removeFromDb(segment.id);
      uploading = false;
      notifyStatus();
      scheduleProcess();
    } catch (error) {
      uploading = false;
      const err = error instanceof Error ? error : new Error(String(error));
      const nonRetryable = error instanceof NonRetryableUploadError;
      segment.retryCount += 1;
      segment.lastError = err.message;

      if (nonRetryable || segment.retryCount > maxRetries) {
        // Retain in IndexedDB with failed=true so evidence is never silently lost
        memoryQueue.shift();
        segment.failed = true;
        failedQueue.push(segment);
        await saveToDb(segment);
        config.onPermanentFailure(segment, err);
        notifyStatus();
        scheduleProcess();
        return;
      }

      await saveToDb(segment);
      const delay = jitter(MAX_RETRY_DELAYS[Math.min(segment.retryCount - 1, MAX_RETRY_DELAYS.length - 1)] ?? 60000);
      notifyStatus();
      scheduleProcess(delay);
    }
  };

  return {
    async enqueue(segmentData) {
      if (segmentData.sessionId !== config.sessionId || segmentData.examId !== config.examId) {
        throw new Error('Segment session/exam mismatch');
      }
      if (memoryQueue.length >= maxQueueSize) {
        throw new Error('Upload queue full — backpressure limit reached');
      }
      if (dbChecked && !db && config.requireDurablePersistence) {
        const err = new Error('IndexedDB durable persistence unavailable');
        config.onStorageUnavailable?.(err);
        throw err;
      }

      const duplicate = memoryQueue.some((s) => s.sequenceNumber === segmentData.sequenceNumber)
        || failedQueue.some((s) => s.sequenceNumber === segmentData.sequenceNumber);
      if (duplicate) return;

      const segment: QueuedSegment = {
        ...segmentData,
        retryCount: 0,
        enqueuedAt: Date.now(),
        failed: false,
      };

      const persisted = await saveToDb(segment);
      if (!persisted && config.requireDurablePersistence) {
        const err = new Error('Failed to persist segment to IndexedDB');
        config.onStorageUnavailable?.(err);
        throw err;
      }

      memoryQueue.push(segment);
      notifyStatus();
      scheduleProcess(initialDelay());
    },

    async start(): Promise<boolean> {
      running = true;
      const database = await openDb();
      db = database;
      dbChecked = true;

      if (!db && config.requireDurablePersistence) {
        running = false;
        const err = new Error('IndexedDB unavailable for mandatory recording');
        config.onStorageUnavailable?.(err);
        return false;
      }

      if (db) {
        await new Promise<void>((resolve) => {
          try {
            const tx = db!.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).index('sessionId').getAll(config.sessionId);
            req.onsuccess = () => {
              const recovered = ((req.result ?? []) as QueuedSegment[])
                .filter((s) => s.examId === config.examId && s.sessionId === config.sessionId);
              recovered.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
              const known = new Set([...memoryQueue, ...failedQueue].map((s) => s.id));
              for (const seg of recovered) {
                if (known.has(seg.id)) continue;
                if (seg.failed) {
                  failedQueue.push(seg);
                } else if (memoryQueue.length < maxQueueSize) {
                  memoryQueue.push(seg);
                }
              }
              notifyStatus();
              resolve();
            };
            req.onerror = () => resolve();
          } catch {
            resolve();
          }
        });
      }

      scheduleProcess(initialDelay());
      return true;
    },

    stop() {
      running = false;
      if (processTimer) { window.clearTimeout(processTimer); processTimer = 0; }
    },

    retryFailed() {
      if (failedQueue.length === 0) return;
      while (failedQueue.length > 0 && memoryQueue.length < maxQueueSize) {
        const seg = failedQueue.shift()!;
        seg.failed = false;
        seg.retryCount = 0;
        memoryQueue.push(seg);
        void saveToDb(seg);
      }
      notifyStatus();
      if (running) scheduleProcess(0);
    },

    async flush(timeoutMs = 15_000): Promise<{ pending: number; failed: number; timedOut: boolean }> {
      if (memoryQueue.length === 0 && !uploading) {
        return { pending: 0, failed: failedQueue.length, timedOut: false };
      }
      if (running) scheduleProcess(0);
      const timedOut = await new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => resolve(true), timeoutMs);
        flushWaiters.push(() => {
          window.clearTimeout(timer);
          resolve(false);
        });
      });
      return { pending: memoryQueue.length, failed: failedQueue.length, timedOut };
    },

    get pendingCount() { return memoryQueue.length; },
    get failedCount() { return failedQueue.length; },
  };
}

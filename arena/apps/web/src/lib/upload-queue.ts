/**
 * Segment upload queue with IndexedDB persistence.
 *
 * Segments are stored in IndexedDB before upload so they survive
 * browser suspension and page reloads. After successful upload
 * confirmation from the API, the segment is removed.
 *
 * Uses exponential backoff with jitter for retries.
 * Bounded queue — rejects new segments if too many are pending.
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
}

export interface UploadQueueConfig {
  sessionId: string;
  examId: number;
  maxQueueSize?: number;
  maxRetries?: number;
  /** Called to get presigned URL for a segment */
  requestPresignedUrl: (segment: QueuedSegment) => Promise<{ upload_url: string; segment_id: number }>;
  /** Called after successful upload to confirm with API */
  confirmUpload: (segment: QueuedSegment, segmentId: number, fileSizeBytes: number) => Promise<void>;
  /** Called when a segment is permanently failed */
  onPermanentFailure: (segment: QueuedSegment, error: Error) => void;
  /** Called when upload status changes */
  onStatusChange?: (pending: number, uploading: boolean) => void;
}

const DB_NAME = 'arena-recording-queue';
const DB_VERSION = 1;
const STORE_NAME = 'segments';
const MAX_RETRY_DELAYS = [2000, 5000, 10000, 20000, 30000, 60000];

export interface UploadQueue {
  enqueue(segment: Omit<QueuedSegment, 'retryCount' | 'enqueuedAt'>): Promise<void>;
  start(): void;
  stop(): void;
  readonly pendingCount: number;
}

async function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
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
    request.onerror = () => resolve(null); // Non-fatal: fall back to memory queue
  });
}

export function createUploadQueue(config: UploadQueueConfig): UploadQueue {
  const maxQueueSize = config.maxQueueSize ?? 20;
  const maxRetries = config.maxRetries ?? 5;

  let db: IDBDatabase | null = null;
  let memoryQueue: QueuedSegment[] = [];
  let uploading = false;
  let running = false;
  let processTimer = 0;

  const jitter = (baseMs: number) => baseMs + Math.floor(Math.random() * 1000);

  const scheduleProcess = (delayMs = 0) => {
    if (!running) return;
    if (processTimer) window.clearTimeout(processTimer);
    processTimer = window.setTimeout(() => {
      processTimer = 0;
      void processNext();
    }, delayMs);
  };

  const processNext = async () => {
    if (!running || uploading || memoryQueue.length === 0) return;

    const segment = memoryQueue[0]!;
    uploading = true;
    config.onStatusChange?.(memoryQueue.length, true);

    try {
      const { upload_url, segment_id } = await config.requestPresignedUrl(segment);

      const response = await fetch(upload_url, {
        method: 'PUT',
        body: segment.blob,
        headers: { 'Content-Type': segment.mimeType },
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      await config.confirmUpload(segment, segment_id, segment.blob.size);

      // Success — remove from queue
      memoryQueue.shift();
      await removeFromDb(segment.id);
      config.onStatusChange?.(memoryQueue.length, false);
      uploading = false;
      scheduleProcess(); // Process next
    } catch (error) {
      uploading = false;
      segment.retryCount += 1;

      if (segment.retryCount > maxRetries) {
        // Permanent failure
        memoryQueue.shift();
        await removeFromDb(segment.id);
        config.onPermanentFailure(segment, error instanceof Error ? error : new Error(String(error)));
        config.onStatusChange?.(memoryQueue.length, false);
        scheduleProcess();
        return;
      }

      const delay = jitter(MAX_RETRY_DELAYS[Math.min(segment.retryCount - 1, MAX_RETRY_DELAYS.length - 1)] ?? 60000);
      config.onStatusChange?.(memoryQueue.length, false);
      scheduleProcess(delay);
    }
  };

  const saveToDb = async (segment: QueuedSegment) => {
    if (!db) return;
    return new Promise<void>((resolve) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(segment);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // non-fatal
    });
  };

  const removeFromDb = async (id: string) => {
    if (!db) return;
    return new Promise<void>((resolve) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  };

  return {
    async enqueue(segmentData) {
      if (memoryQueue.length >= maxQueueSize) {
        throw new Error('Upload queue full — segment dropped');
      }

      const segment: QueuedSegment = {
        ...segmentData,
        retryCount: 0,
        enqueuedAt: Date.now(),
      };

      memoryQueue.push(segment);
      await saveToDb(segment);
      config.onStatusChange?.(memoryQueue.length, uploading);
      scheduleProcess();
    },

    start() {
      running = true;
      void openDb().then((database) => {
        db = database;
        // Recover any segments from previous session
        if (db) {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).index('sessionId').getAll(config.sessionId);
          req.onsuccess = () => {
            const recovered = (req.result ?? []) as QueuedSegment[];
            if (recovered.length > 0) {
              recovered.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
              // Add recovered segments that aren't already in memory queue
              const inQueue = new Set(memoryQueue.map((s) => s.id));
              for (const seg of recovered) {
                if (!inQueue.has(seg.id) && memoryQueue.length < maxQueueSize) {
                  memoryQueue.push(seg);
                }
              }
              config.onStatusChange?.(memoryQueue.length, false);
              scheduleProcess();
            }
          };
        }
        scheduleProcess();
      });
    },

    stop() {
      running = false;
      if (processTimer) { window.clearTimeout(processTimer); processTimer = 0; }
    },

    get pendingCount() { return memoryQueue.length; },
  };
}

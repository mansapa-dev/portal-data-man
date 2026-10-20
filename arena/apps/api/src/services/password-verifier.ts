import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

export type VerifyResult = {
  valid: boolean;
  queueWaitMs: number;
  computeMs: number;
  malformed?: boolean;
};

type Job = {
  id: number;
  secret: string;
  encoded: string;
  signal?: AbortSignal;
  enqueuedAt: number;
  dispatchedAt?: number;
  timer?: NodeJS.Timeout;
  resolve: (result: VerifyResult) => void;
  reject: (error: Error) => void;
};

type Slot = {
  worker?: Worker;
  ready: boolean;
  inFlight: Map<number, Job>;
  restartTimer?: NodeJS.Timeout;
};

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; id: number; valid?: boolean; malformed?: boolean; computeMs?: number; error?: boolean };

// Configurable worker topology: defaults to (CPU cores - 1) workers to guarantee at least 1 core for event loop & exam APIs
const parallelism = availableParallelism();
const configuredWorkers = Number(process.env.PASSWORD_VERIFY_WORKERS ?? Math.max(1, parallelism - 1));
const workerCount = Number.isSafeInteger(configuredWorkers) && configuredWorkers > 0 ? Math.min(configuredWorkers, 16) : 1;

const configuredQueue = Number(process.env.PASSWORD_VERIFY_QUEUE_LIMIT ?? 1_000);
const queueLimit = Number.isSafeInteger(configuredQueue) && configuredQueue > 0 ? Math.min(configuredQueue, 20_000) : 1_000;

const configuredConcurrency = Number(process.env.PASSWORD_VERIFY_CONCURRENCY_PER_WORKER ?? 1);
const maxConcurrentPerWorker = Number.isSafeInteger(configuredConcurrency) && configuredConcurrency > 0 ? Math.min(configuredConcurrency, 8) : 1;

const configuredQueueTimeout = Number(process.env.PASSWORD_VERIFY_QUEUE_TIMEOUT_MS ?? 12_000);
const queueTimeoutMs = Number.isSafeInteger(configuredQueueTimeout) && configuredQueueTimeout > 0 ? configuredQueueTimeout : 12_000;

const workerUrl = new URL(import.meta.url.endsWith('.ts') ? './password-verify-worker.ts' : './password-verify-worker.js', import.meta.url);
const slots: Slot[] = Array.from({ length: workerCount }, () => ({ ready: false, inFlight: new Map() }));
const queue: Job[] = [];
let nextId = 1;
let closed = false;

const stats = {
  totalJobs: 0,
  completedJobs: 0,
  rejected: 0,
  timeouts: 0,
};

export function getVerifierStats() {
  let inFlightCount = 0;
  let readyWorkers = 0;
  for (const slot of slots) {
    if (slot.ready) readyWorkers++;
    inFlightCount += slot.inFlight.size;
  }
  return {
    workers: workerCount,
    readyWorkers,
    maxConcurrentPerWorker,
    inFlightCount,
    queueDepth: queue.length,
    queueLimit,
    queueTimeoutMs,
    totalJobs: stats.totalJobs,
    completedJobs: stats.completedJobs,
    rejectedJobs: stats.rejected,
    timeoutJobs: stats.timeouts,
  };
}

function dispatch() {
  if (closed) return;
  while (queue.length > 0) {
    let bestSlot: Slot | undefined;
    let minInFlight = maxConcurrentPerWorker;
    for (const slot of slots) {
      if (!slot.ready || !slot.worker) continue;
      if (slot.inFlight.size < minInFlight) {
        minInFlight = slot.inFlight.size;
        bestSlot = slot;
      }
    }
    if (!bestSlot) break;

    let job: Job | undefined;
    while (queue.length > 0) {
      const candidate = queue.shift()!;
      if (candidate.timer) {
        clearTimeout(candidate.timer);
        candidate.timer = undefined;
      }
      if (candidate.signal?.aborted) {
        candidate.reject(Object.assign(new Error('Permintaan verifikasi dibatalkan oleh klien'), { statusCode: 499 }));
        continue;
      }
      job = candidate;
      break;
    }
    if (!job) break;

    const worker = bestSlot.worker;
    if (!worker) break;

    job.dispatchedAt = performance.now();
    bestSlot.inFlight.set(job.id, job);
    try {
      worker.postMessage({ id: job.id, secret: job.secret, encoded: job.encoded });
    } catch {
      bestSlot.inFlight.delete(job.id);
      job.reject(Object.assign(new Error('Verifikasi kredensial sedang tidak tersedia'), { statusCode: 503, retryAfter: 2 }));
    }
  }
}

function spawn(slot: Slot) {
  if (closed) return;
  const worker = new Worker(workerUrl, workerUrl.href.endsWith('.ts') ? { execArgv: ['--import', 'tsx'] } : undefined);
  slot.worker = worker;
  slot.ready = false;
  worker.unref();
  worker.on('message', (message: WorkerMessage) => {
    if (slot.worker !== worker) return;
    if (message.type === 'ready') {
      slot.ready = true;
      dispatch();
      return;
    }
    const job = slot.inFlight.get(message.id);
    if (!job) return;
    slot.inFlight.delete(message.id);
    if (message.error) {
      job.reject(Object.assign(new Error('Verifikasi kredensial gagal'), { statusCode: 503, retryAfter: 2 }));
    } else {
      stats.completedJobs++;
      const queueWaitMs = (job.dispatchedAt ?? performance.now()) - job.enqueuedAt;
      const computeMs = message.computeMs ?? 0;
      job.resolve({
        valid: Boolean(message.valid),
        queueWaitMs,
        computeMs,
        malformed: Boolean(message.malformed),
      });
    }
    dispatch();
  });
  const fail = () => {
    if (slot.worker !== worker) return;
    slot.ready = false;
    for (const [, job] of slot.inFlight) {
      if (job.timer) clearTimeout(job.timer);
      job.reject(Object.assign(new Error('Verifikasi kredensial sedang tidak tersedia'), { statusCode: 503, retryAfter: 2 }));
    }
    slot.inFlight.clear();
    slot.worker = undefined;
    if (!closed && !slot.restartTimer) {
      slot.restartTimer = setTimeout(() => { slot.restartTimer = undefined; spawn(slot); }, 250);
      slot.restartTimer.unref();
    }
  };
  worker.on('error', fail);
  worker.on('exit', (code) => { if (code !== 0) fail(); });
}

for (const slot of slots) spawn(slot);

export function verifyPasswordDetails(secret: string, encoded: string, signal?: AbortSignal): Promise<VerifyResult> {
  if (closed) {
    return Promise.reject(Object.assign(new Error('Verifikasi kredensial sedang tidak tersedia'), { statusCode: 503, retryAfter: 2 }));
  }
  if (signal?.aborted) {
    return Promise.reject(Object.assign(new Error('Permintaan verifikasi dibatalkan oleh klien'), { statusCode: 499 }));
  }

  // Fast rejection if hash is not a string or doesn't have bcrypt signature (does not require worker dispatch)
  if (typeof encoded !== 'string' || !encoded.startsWith('$2')) {
    return Promise.resolve({ valid: false, queueWaitMs: 0, computeMs: 0, malformed: true });
  }

  if (queue.length >= queueLimit) {
    stats.rejected++;
    return Promise.reject(Object.assign(new Error('Layanan login sedang sibuk. Coba lagi sebentar.'), { statusCode: 503, retryAfter: 2 }));
  }

  stats.totalJobs++;
  return new Promise((resolve, reject) => {
    const job: Job = {
      id: nextId++,
      secret,
      encoded,
      signal,
      enqueuedAt: performance.now(),
      resolve,
      reject,
    };

    if (queueTimeoutMs > 0) {
      job.timer = setTimeout(() => {
        const idx = queue.indexOf(job);
        if (idx !== -1) {
          queue.splice(idx, 1);
          stats.timeouts++;
          job.reject(Object.assign(new Error('Layanan login sedang sibuk. Coba lagi sebentar.'), { statusCode: 503, retryAfter: 2 }));
        }
      }, queueTimeoutMs);
      job.timer.unref();
    }

    queue.push(job);
    dispatch();
  });
}

export async function verifyPassword(secret: string, encoded: string, signal?: AbortSignal): Promise<boolean> {
  const result = await verifyPasswordDetails(secret, encoded, signal);
  return result.valid;
}

export async function closePasswordVerifier() {
  closed = true;
  for (const slot of slots) {
    if (slot.restartTimer) clearTimeout(slot.restartTimer);
    for (const [, job] of slot.inFlight) {
      if (job.timer) clearTimeout(job.timer);
      job.reject(Object.assign(new Error('Server sedang dimatikan'), { statusCode: 503 }));
    }
    slot.inFlight.clear();
    slot.worker?.removeAllListeners();
    await slot.worker?.terminate();
    slot.worker = undefined;
  }
  for (const job of queue.splice(0)) {
    if (job.timer) clearTimeout(job.timer);
    job.reject(Object.assign(new Error('Server sedang dimatikan'), { statusCode: 503 }));
  }
}

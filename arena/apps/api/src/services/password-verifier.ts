import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';

type Job = { id: number; secret: string; encoded: string; signal?: AbortSignal; resolve: (valid: boolean) => void; reject: (error: Error) => void };
type Slot = { worker?: Worker; ready: boolean; inFlight: Map<number, Job>; restartTimer?: NodeJS.Timeout };
type WorkerMessage = { type: 'ready' } | { type: 'result'; id: number; valid?: boolean; error?: boolean };

const configuredWorkers = Number(process.env.PASSWORD_VERIFY_WORKERS ?? Math.max(2, availableParallelism()));
const workerCount = Number.isSafeInteger(configuredWorkers) && configuredWorkers > 0 ? Math.min(configuredWorkers, 16) : 2;
const configuredQueue = Number(process.env.PASSWORD_VERIFY_QUEUE_LIMIT ?? 5_000);
const queueLimit = Number.isSafeInteger(configuredQueue) && configuredQueue > 0 ? Math.min(configuredQueue, 20_000) : 5_000;
const configuredConcurrency = Number(process.env.PASSWORD_VERIFY_CONCURRENCY_PER_WORKER ?? 4);
const maxConcurrentPerWorker = Number.isSafeInteger(configuredConcurrency) && configuredConcurrency > 0 ? Math.min(configuredConcurrency, 8) : 4;

const workerUrl = new URL(import.meta.url.endsWith('.ts') ? './password-verify-worker.ts' : './password-verify-worker.js', import.meta.url);
const slots: Slot[] = Array.from({ length: workerCount }, () => ({ ready: false, inFlight: new Map() }));
const queue: Job[] = [];
let nextId = 1;
let closed = false;

// Fast in-memory cache for positive credential verifications (TTL: 15 minutes, max: 5000)
const verifiedCache = new Map<string, number>();
const VERIFIED_CACHE_TTL_MS = 15 * 60_000;
const VERIFIED_CACHE_MAX = 5_000;

function cacheKey(secret: string, encoded: string): string {
  return createHash('sha256').update(`${secret}:${encoded}`).digest('hex');
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

    bestSlot.inFlight.set(job.id, job);
    try {
      worker.postMessage({ id: job.id, secret: job.secret, encoded: job.encoded });
    } catch {
      bestSlot.inFlight.delete(job.id);
      job.reject(Object.assign(new Error('Verifikasi kredensial sedang tidak tersedia'), { statusCode: 503 }));
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
    if (message.error || typeof message.valid !== 'boolean') {
      job.reject(Object.assign(new Error('Verifikasi kredensial gagal'), { statusCode: 503 }));
    } else {
      if (message.valid) {
        if (verifiedCache.size >= VERIFIED_CACHE_MAX) {
          const oldestKey = verifiedCache.keys().next().value;
          if (oldestKey) verifiedCache.delete(oldestKey);
        }
        verifiedCache.set(cacheKey(job.secret, job.encoded), Date.now() + VERIFIED_CACHE_TTL_MS);
      }
      job.resolve(message.valid);
    }
    dispatch();
  });
  const fail = () => {
    if (slot.worker !== worker) return;
    slot.ready = false;
    for (const [, job] of slot.inFlight) {
      job.reject(Object.assign(new Error('Verifikasi kredensial sedang tidak tersedia'), { statusCode: 503 }));
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

export function verifyPassword(secret: string, encoded: string, signal?: AbortSignal): Promise<boolean> {
  if (closed) return Promise.reject(Object.assign(new Error('Verifikasi kredensial sedang tidak tersedia'), { statusCode: 503 }));
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('Permintaan verifikasi dibatalkan oleh klien'), { statusCode: 499 }));

  // Check verified cache first
  const key = cacheKey(secret, encoded);
  const expiry = verifiedCache.get(key);
  if (expiry !== undefined) {
    if (Date.now() < expiry) return Promise.resolve(true);
    verifiedCache.delete(key);
  }

  if (queue.length >= queueLimit) return Promise.reject(Object.assign(new Error('Layanan login sedang sibuk. Coba lagi sebentar.'), { statusCode: 503 }));
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, secret, encoded, signal, resolve, reject });
    dispatch();
  });
}

export async function closePasswordVerifier() {
  closed = true;
  verifiedCache.clear();
  for (const slot of slots) {
    if (slot.restartTimer) clearTimeout(slot.restartTimer);
    for (const [, job] of slot.inFlight) {
      job.reject(Object.assign(new Error('Server sedang dimatikan'), { statusCode: 503 }));
    }
    slot.inFlight.clear();
    slot.worker?.removeAllListeners();
    await slot.worker?.terminate();
    slot.worker = undefined;
  }
  for (const job of queue.splice(0)) job.reject(Object.assign(new Error('Server sedang dimatikan'), { statusCode: 503 }));
}

import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

type Job = { id: number; secret: string; encoded: string; resolve: (valid: boolean) => void; reject: (error: Error) => void };
type Slot = { worker?: Worker; ready: boolean; current?: Job; restartTimer?: NodeJS.Timeout };
type WorkerMessage = { type: 'ready' } | { type: 'result'; id: number; valid?: boolean; error?: boolean };

const configuredWorkers = Number(process.env.PASSWORD_VERIFY_WORKERS ?? Math.max(1, Math.min(3, availableParallelism() - 1)));
const workerCount = Number.isSafeInteger(configuredWorkers) && configuredWorkers > 0 ? Math.min(configuredWorkers, 8) : 1;
const configuredQueue = Number(process.env.PASSWORD_VERIFY_QUEUE_LIMIT ?? 1_000);
const queueLimit = Number.isSafeInteger(configuredQueue) && configuredQueue > 0 ? Math.min(configuredQueue, 10_000) : 1_000;
const workerUrl = new URL(import.meta.url.endsWith('.ts') ? './password-verify-worker.ts' : './password-verify-worker.js', import.meta.url);
const slots: Slot[] = Array.from({ length: workerCount }, () => ({ ready: false }));
const queue: Job[] = [];
let nextId = 1;
let closed = false;

function dispatch() {
  if (closed) return;
  for (const slot of slots) {
    if (!slot.ready || slot.current || !slot.worker) continue;
    const job = queue.shift();
    if (!job) return;
    slot.current = job;
    try {
      slot.worker.postMessage({ id: job.id, secret: job.secret, encoded: job.encoded });
    } catch {
      slot.current = undefined;
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
    const job = slot.current;
    if (!job || job.id !== message.id) return;
    slot.current = undefined;
    if (message.error || typeof message.valid !== 'boolean') job.reject(Object.assign(new Error('Verifikasi kredensial gagal'), { statusCode: 503 }));
    else job.resolve(message.valid);
    dispatch();
  });
  const fail = () => {
    if (slot.worker !== worker) return;
    slot.ready = false;
    if (slot.current) {
      slot.current.reject(Object.assign(new Error('Verifikasi kredensial sedang tidak tersedia'), { statusCode: 503 }));
      slot.current = undefined;
    }
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

export function verifyPassword(secret: string, encoded: string): Promise<boolean> {
  if (closed) return Promise.reject(Object.assign(new Error('Verifikasi kredensial sedang tidak tersedia'), { statusCode: 503 }));
  if (queue.length >= queueLimit) return Promise.reject(Object.assign(new Error('Layanan login sedang sibuk. Coba lagi sebentar.'), { statusCode: 503 }));
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, secret, encoded, resolve, reject });
    dispatch();
  });
}

export async function closePasswordVerifier() {
  closed = true;
  for (const slot of slots) {
    if (slot.restartTimer) clearTimeout(slot.restartTimer);
    slot.current?.reject(Object.assign(new Error('Server sedang dimatikan'), { statusCode: 503 }));
    slot.current = undefined;
    slot.worker?.removeAllListeners();
    await slot.worker?.terminate();
    slot.worker = undefined;
  }
  for (const job of queue.splice(0)) job.reject(Object.assign(new Error('Server sedang dimatikan'), { statusCode: 503 }));
}

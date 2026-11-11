import Fastify from 'fastify';
import { requirePool } from './lib/db.js';
import { ScoringService } from './services/scoring.js';
import { ExpiredAttemptFinalizer } from './services/expired-attempt-finalizer.js';
import { createFinalizationQueue, createFinalizationWorker } from './services/finalization-queue.js';

const url = process.env.REDIS_URL;
if (!url) throw new Error('REDIS_URL is required for BullMQ');
const pool = requirePool();
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });
const scoring = new ScoringService(pool);
const producer = createFinalizationQueue(url);
const consumer = createFinalizationWorker(url, scoring, Number(process.env.FINALIZATION_CONCURRENCY ?? 4), { pool });
producer.queue.on('error', (err) => app.log.error({ err }, 'finalization queue error'));
consumer.worker.on('error', (err) => app.log.error({ err }, 'finalization worker error'));
consumer.worker.on('failed', (job, err) => app.log.error({ err, jobId: job?.id }, 'finalization job failed'));
await producer.queue.waitUntilReady();
await consumer.worker.waitUntilReady();
// A single scanner takes a MySQL advisory lock. Redis loss cannot lose work:
// unresolved attempts are rediscovered from MySQL on the next scan.
const scanner = new ExpiredAttemptFinalizer(pool, scoring, app.log, 10000, 1500, 40000, 1, 4, producer.enqueue);
scanner.start();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await scanner.stop();
  await consumer.close();
  await producer.close();
  await pool.end();
  await app.close();
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });

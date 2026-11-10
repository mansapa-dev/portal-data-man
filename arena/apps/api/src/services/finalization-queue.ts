import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { ScoringService } from './scoring.js';

export const FINALIZATION_QUEUE = 'arena-finalization';
export type FinalizationJob = { studentId: number; examId: number };

// Separate connections: a worker must reconnect indefinitely, while producers
// must fail promptly. MySQL remains the durable source for reconciliation.
export function createFinalizationQueue(url: string) {
  const connection = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 2000 });
  const queue = new Queue<FinalizationJob>(FINALIZATION_QUEUE, { connection });
  return {
    queue,
    async enqueue(studentId: number, examId: number) {
      await queue.add('finalize', { studentId, examId }, {
        jobId: `attempt-${studentId}-${examId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: true,
      });
    },
    async close() { await queue.close(); connection.disconnect(); },
  };
}

export function createFinalizationWorker(url: string, scoring: ScoringService, concurrency: number) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('FINALIZATION_CONCURRENCY must be 1..32');
  const connection = new Redis(url, { maxRetriesPerRequest: null });
  const worker = new Worker<FinalizationJob>(FINALIZATION_QUEUE, async (job) => {
    const { studentId, examId } = job.data;
    if (!Number.isSafeInteger(studentId) || studentId <= 0 || !Number.isSafeInteger(examId) || examId <= 0) throw new Error('Invalid finalization job');
    try { return await scoring.submit(studentId, examId, true); }
    catch (error) {
      // A queued job can outlive an admin reset or LOCK. Never force-submit it.
      if ([404, 409].includes(Number((error as { statusCode?: number }).statusCode))) return { skipped: true };
      throw error;
    }
  }, { connection, concurrency });
  return { worker, async close() { await worker.close(); connection.disconnect(); } };
}

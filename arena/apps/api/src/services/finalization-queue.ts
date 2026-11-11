import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Pool } from 'mysql2/promise';
import type { ScoringService } from './scoring.js';
import { claimSubmission, completeSubmission, renewLease, skipSubmission, isDeferredError } from './exam-submission.js';

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

function skipReasonFromError(error: unknown): string {
  const statusCode = Number((error as { statusCode?: number }).statusCode ?? 500);
  const message = String((error as Error).message ?? '');
  if (statusCode === 404) return 'attempt_missing';
  if (message.includes('dikunci')) return 'lock';
  if (message.includes('Snapshot')) return 'snapshot_missing';
  if (message.includes('masih aktif')) return 'still_active';
  return 'rejected';
}

/**
 * Eksekusi satu job finalisasi dengan klaim submission dulu (desain A3 §2).
 * - Tanpa baris submission → finalisasi legacy seperti sebelumnya; bila
 *   submission muncul di antara claim dan scoring, guard submission-aware di
 *   `submitOnce` menolak dengan SUBMISSION_DEFERRED dan job menyerah ke
 *   submission worker / reconciler.
 * - Dengan klaim berhasil → worker mengeksekusi scoring `onBehalfOfSubmission`,
 *   memperpanjang lease tiap lease/3, memfinalisasi state DONE dengan fencing
 *   token, atau menandai SKIPPED untuk 409/404 (LOCK, snapshot hilang, dsb).
 */
export async function executeSubmissionFinalization(pool: Pool, scoring: ScoringService, studentId: number, examId: number): Promise<unknown> {
  const claim = await claimSubmission(pool, studentId, examId);
  if (claim.kind === 'skipped') return { skipped: true, reason: claim.reason };
  if (claim.kind === 'busy') return { deferred: true };
  if (claim.kind === 'legacy') {
    try {
      return await scoring.submit(studentId, examId, true);
    } catch (error) {
      if (isDeferredError(error)) return { deferred: true };
      if ([404, 409].includes(Number((error as { statusCode?: number }).statusCode))) {
        return { skipped: true, reason: skipReasonFromError(error) };
      }
      throw error;
    }
  }
  const { attemptId, token, acceptedExpired, acceptedStatus, leaseMs, hadResults } = claim;
  const renewalMs = Math.max(1_000, Math.floor(leaseMs / 3));
  const renewal = setInterval(() => { void renewLease(pool, attemptId, token, leaseMs).catch(() => { /* lease renewal is best-effort; takeover covers */ }); }, renewalMs);
  try {
    // statusOverride mengikuti snapshot accepted_* TX1: submit sebelum deadline
    // → COMPLETED, sesudahnya EXPIRED; attempt TERMINATED dipertahankan (null).
    const statusOverride = acceptedStatus === 'TERMINATED' ? null : (acceptedExpired ? 'EXPIRED' : 'COMPLETED');
    try {
      // finalizeOnly=false: submission yang diterima saat ujian masih aktif
      // tidak boleh ditolak guard "Ujian masih aktif"; klasifikasi status tetap
      // ditentukan statusOverride.
      const result = await scoring.submit(studentId, examId, false, { onBehalfOfSubmission: true, statusOverride });
      await completeSubmission(pool, attemptId, token, { claimedHadResults: hadResults });
      return result;
    } catch (error) {
      if ([404, 409].includes(Number((error as { statusCode?: number }).statusCode))) {
        const reason = skipReasonFromError(error);
        await skipSubmission(pool, attemptId, token, reason);
        return { skipped: true, reason };
      }
      throw error;
    }
  } finally {
    clearInterval(renewal);
  }
}

export function createFinalizationWorker(url: string, scoring: ScoringService, concurrency: number, opts: { pool?: Pool } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('FINALIZATION_CONCURRENCY must be 1..32');
  const connection = new Redis(url, { maxRetriesPerRequest: null });
  const worker = new Worker<FinalizationJob>(FINALIZATION_QUEUE, async (job) => {
    const { studentId, examId } = job.data;
    if (!Number.isSafeInteger(studentId) || studentId <= 0 || !Number.isSafeInteger(examId) || examId <= 0) throw new Error('Invalid finalization job');
    if (!opts.pool) {
      // Mode legacy (tanpa pool, dipakai test perilaku BullMQ): scoring langsung.
      try { return await scoring.submit(studentId, examId, true); }
      catch (error) {
        // A queued job can outlive an admin reset or LOCK. Never force-submit it.
        if ([404, 409].includes(Number((error as { statusCode?: number }).statusCode))) return { skipped: true };
        throw error;
      }
    }
    return await executeSubmissionFinalization(opts.pool, scoring, studentId, examId);
  }, { connection, concurrency });
  return { worker, async close() { await worker.close(); connection.disconnect(); } };
}

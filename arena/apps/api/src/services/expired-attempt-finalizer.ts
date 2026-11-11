import type { FastifyBaseLogger } from 'fastify';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ScoringService } from './scoring.js';
import { executeSubmissionFinalization } from './finalization-queue.js';

const LOCK_NAME = 'arena:expired-attempt-finalizer';
// Self-heal DONE-tanpa-hasil (desain A3 §3.4): window teoretis rollback hasil
// setelah state DONE. Loop perbaikan terbatas 1×/jam per baris.
const DONE_WITHOUT_RESULTS_MAX_AGE_MS = 3_600_000;

export async function selfHealDoneWithoutResults(pool: Pool, maxAgeMs: number = DONE_WITHOUT_RESULTS_MAX_AGE_MS): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE exam_submissions s SET s.state='RECEIVED', s.lease_attempts=0, s.claim_token=NULL
     WHERE s.state='DONE' AND s.finalized_at < UTC_TIMESTAMP(3) - INTERVAL ? MICROSECOND
       AND NOT EXISTS (SELECT 1 FROM exam_results r WHERE r.attempt_id=s.attempt_id)`,
    [maxAgeMs * 1000],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

/**
 * Scan submission yang perlu akselerasi: RECEIVED (belum pernah diproses) dan
 * PROCESSING dengan lease kedaluwarsa (worker mati/selesai crash). SKIPPED dan
 * DONE sengaja dikecualikan — SKIPPED butuh jalur pemulihan yang dirancang,
 * DONE sudah final. Ini juga menutup kegagalan enqueue BullMQ: baris RECEIVED
 * tetap di MySQL dan di-enqueue ulang setiap tick.
 */
export async function scanPendingSubmissions(pool: Pool, limit: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.student_id, s.exam_id FROM exam_submissions s
     WHERE s.state='RECEIVED' OR (s.state='PROCESSING' AND s.lease_expires_at < UTC_TIMESTAMP(3))
     ORDER BY s.received_at, s.id LIMIT ?`,
    [limit],
  );
  return rows;
}

export class ExpiredAttemptFinalizer {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly pool: Pool,
    private readonly scoring: ScoringService,
    private readonly logger: FastifyBaseLogger,
    private readonly intervalMs: number,
    private readonly batchSize: number,
    // A mass expiry (one exam ending for a whole grade) can leave >1000 attempts
    // to finalize. One batch per tick took ~10 minutes for 1015 attempts, so a
    // single run now drains several batches inside a bounded time budget. The
    // GET_LOCK below still guarantees only one instance works on the backlog.
    private readonly maxRunMs = 40_000,
    private readonly maxBatches = 40,
    private readonly concurrency = 4,
    private readonly enqueue?: (studentId: number, examId: number) => Promise<void>,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.run(); }, this.intervalMs);
    this.timer.unref();
    void this.run();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    this.inFlight = this.processBatch();
    try { await this.inFlight; }
    finally { this.running = false; this.inFlight = undefined; }
  }

  private async processPendingSubmissions() {
    const pending = await scanPendingSubmissions(this.pool, this.batchSize);
    if (!pending.length) return;
    let next = 0, dispatched = 0, failed = 0;
    const worker = async () => {
      while (true) {
        const index = next++;
        if (index >= pending.length) return;
        const row = pending[index]!;
        try {
          if (this.enqueue) await this.enqueue(Number(row.student_id), Number(row.exam_id));
          else await executeSubmissionFinalization(this.pool, this.scoring, Number(row.student_id), Number(row.exam_id));
          dispatched++;
        } catch (error) {
          failed++;
          this.logger.warn({ err: error, student_id: Number(row.student_id), exam_id: Number(row.exam_id) }, 'submission reconciliation dispatch failed');
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, pending.length) }, worker));
    this.logger.info({ scanned: pending.length, dispatched, failed }, 'submission reconciliation pass finished');
  }

  private async processBatch() {
    let lock: PoolConnection | undefined;
    let acquired = false;
    try {
      lock = await this.pool.getConnection();
      const [lockRows] = await lock.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) acquired', [LOCK_NAME]);
      acquired = Number(lockRows[0]?.acquired) === 1;
      if (!acquired) return;

      const deadline = Date.now() + this.maxRunMs;
      let finalized = 0, failed = 0, scanned = 0, batches = 0;
      // Self-heal DONE-tanpa-hasil → kembali RECEIVED agar diproses ulang.
      const healed = await selfHealDoneWithoutResults(this.pool);
      if (healed > 0) this.logger.warn({ healed }, 'submission DONE-without-results self-healed to RECEIVED');
      // Reconciler submission: RECEIVED / PROCESSING lease-expired → enqueue
      // (akselerator) atau eksekusi langsung ketika antrean tidak tersedia.
      await this.processPendingSubmissions();
      while (batches < this.maxBatches && Date.now() < deadline) {
        const [attempts] = await this.pool.query<RowDataPacket[]>(
          `(SELECT student_id,exam_id,expires_at,id FROM exam_attempts
            WHERE status='IN_PROGRESS' AND expires_at<=UTC_TIMESTAMP(3)
              AND NOT EXISTS (SELECT 1 FROM exam_submissions sub WHERE sub.attempt_id=exam_attempts.id)
            ORDER BY expires_at,id LIMIT ?)
           UNION ALL
           (SELECT student_id,exam_id,expires_at,id FROM exam_attempts
            WHERE status='TERMINATED' AND termination_action='AUTO_SUBMIT'
              AND NOT EXISTS (SELECT 1 FROM exam_results r WHERE r.attempt_id=exam_attempts.id)
              AND NOT EXISTS (SELECT 1 FROM exam_submissions sub WHERE sub.attempt_id=exam_attempts.id)
            ORDER BY expires_at,id LIMIT ?)
           ORDER BY expires_at,id LIMIT ?`,
          [this.batchSize, this.batchSize, this.batchSize],
        );
        if (!attempts.length) break;
        batches++;
        scanned += attempts.length;
        let next = 0, finalizedInBatch = 0;
        const worker=async()=>{while(true){const index=next++;if(index>=attempts.length)return;const attempt=attempts[index]!;try{if(this.enqueue) await this.enqueue(Number(attempt.student_id),Number(attempt.exam_id)); else await executeSubmissionFinalization(this.pool,this.scoring,Number(attempt.student_id),Number(attempt.exam_id));finalized++;finalizedInBatch++;}catch(error){failed++;this.logger.warn({err:error,student_id:Number(attempt.student_id),exam_id:Number(attempt.exam_id)},'expired attempt finalization failed');}}};
        await Promise.all(Array.from({length:Math.min(this.concurrency,attempts.length)},worker));
        // No progress means the remaining rows fail permanently (e.g. missing
        // snapshot). Stop instead of re-selecting the same rows until the
        // deadline; the next interval tick will try again.
        if (this.enqueue || !finalizedInBatch) break;
        // Fewer rows than requested means the backlog is empty.
        if (attempts.length < this.batchSize) break;
      }
      if (finalized || failed) this.logger.info({ finalized, failed, scanned, batches }, 'expired attempt finalization run finished');
    } catch (error) {
      this.logger.error({ err: error }, 'expired attempt finalization batch failed');
    } finally {
      if (acquired && lock) try { await lock.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch (error) { this.logger.warn({ err: error }, 'expired attempt finalizer lock release failed'); }
      lock?.release();
    }
  }
}

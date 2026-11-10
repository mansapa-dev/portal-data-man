import type { FastifyBaseLogger } from 'fastify';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ScoringService } from './scoring.js';

const LOCK_NAME = 'arena:expired-attempt-finalizer';

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
      while (batches < this.maxBatches && Date.now() < deadline) {
        const [attempts] = await this.pool.query<RowDataPacket[]>(
          `(SELECT student_id,exam_id,expires_at,id FROM exam_attempts
            WHERE status='IN_PROGRESS' AND expires_at<=UTC_TIMESTAMP(3)
            ORDER BY expires_at,id LIMIT ?)
           UNION ALL
           (SELECT student_id,exam_id,expires_at,id FROM exam_attempts
            WHERE status='TERMINATED' AND termination_action='AUTO_SUBMIT'
              AND NOT EXISTS (SELECT 1 FROM exam_results r WHERE r.attempt_id=exam_attempts.id)
            ORDER BY expires_at,id LIMIT ?)
           ORDER BY expires_at,id LIMIT ?`,
          [this.batchSize, this.batchSize, this.batchSize],
        );
        if (!attempts.length) break;
        batches++;
        scanned += attempts.length;
        let next = 0, finalizedInBatch = 0;
        const worker=async()=>{while(true){const index=next++;if(index>=attempts.length)return;const attempt=attempts[index]!;try{if(this.enqueue) await this.enqueue(Number(attempt.student_id),Number(attempt.exam_id)); else await this.scoring.submit(Number(attempt.student_id),Number(attempt.exam_id),true);finalized++;finalizedInBatch++;}catch(error){failed++;this.logger.warn({err:error,student_id:Number(attempt.student_id),exam_id:Number(attempt.exam_id)},'expired attempt finalization failed');}}};
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

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

      const [attempts] = await this.pool.query<RowDataPacket[]>(
        `SELECT student_id,exam_id FROM exam_attempts
         WHERE status='IN_PROGRESS' AND expires_at<=UTC_TIMESTAMP(3)
         ORDER BY expires_at,id LIMIT ?`,
        [this.batchSize],
      );
      let finalized = 0;
      let failed = 0;
      for (const attempt of attempts) {
        try {
          await this.scoring.submit(Number(attempt.student_id), Number(attempt.exam_id), true);
          finalized++;
        } catch (error) {
          failed++;
          this.logger.warn({ err: error, student_id: Number(attempt.student_id), exam_id: Number(attempt.exam_id) }, 'expired attempt finalization failed');
        }
      }
      if (finalized || failed) this.logger.info({ finalized, failed, scanned: attempts.length }, 'expired attempt finalization batch finished');
    } catch (error) {
      this.logger.error({ err: error }, 'expired attempt finalization batch failed');
    } finally {
      if (acquired && lock) try { await lock.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch (error) { this.logger.warn({ err: error }, 'expired attempt finalizer lock release failed'); }
      lock?.release();
    }
  }
}

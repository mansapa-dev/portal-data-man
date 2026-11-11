import { randomBytes } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

/**
 * Durable async exam submission (Tahap 2).
 *
 * MySQL `exam_submissions` adalah satu-satunya bukti penerimaan submission
 * (durable acceptance record). BullMQ hanyalah akselerator eksekusi: kegagalan
 * enqueue tidak pernah menghilangkan pekerjaan karena reconciler membaca
 * baris RECEIVED langsung dari MySQL.
 *
 * Protokol lock global (anti-deadlock, desain A3): setiap transaksi yang
 * menyentuh kedua tabel mengunci `exam_attempts` DULU, baru `exam_submissions`.
 * Transisi state worker dikunci pada `claim_token` (fencing) sehingga worker
 * yang kehilangan lease tidak pernah bisa mengubah state milik worker lain.
 *
 * Urutan transaksi (bukti race, laporan A3 §2.2-2.3):
 *   TX1     : attempt FOR UPDATE → fast-path exam_results → guard →
 *             submitted_at → INSERT submission RECEIVED → COMMIT.
 *   CLAIM   : attempt FOR UPDATE → claim submission (predikat atomik) → COMMIT.
 *   SCORING : attempt FOR UPDATE → (submission-aware check) → scoring existing.
 *   FINALIZE: attempt FOR UPDATE → submission FOR UPDATE → DONE by token.
 */

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const defaultMaxAttempts = clamp(Number(process.env.SUBMIT_LEASE_MAX_ATTEMPTS ?? 5) || 5, 1, 20);
const defaultLeaseMs = clamp(Number(process.env.SUBMIT_LEASE_MS ?? 60_000) || 60_000, 5_000, 600_000);

export type SubmissionState = 'RECEIVED' | 'PROCESSING' | 'DONE' | 'SKIPPED';

export type AcceptOutcome =
  | { kind: 'accepted' }
  | { kind: 'processing'; state: string }
  | { kind: 'result-exists' }
  | { kind: 'done' }
  | { kind: 'skipped'; reason: string | null };

export type ClaimOutcome =
  | { kind: 'claimed'; attemptId: number; token: string; acceptedExpired: boolean; acceptedStatus: string; leaseMs: number; hadResults: boolean }
  | { kind: 'legacy'; attemptId: number; hadResults: boolean }
  | { kind: 'busy' }
  | { kind: 'skipped'; reason: string | null };

/** Error dengan kode ini berarti finalisasi legacy menyerah pada submission aktif (DEFERRED_409). */
export const DEFERRED_CODE = 'SUBMISSION_DEFERRED';
export function deferredError(): Error {
  return Object.assign(new Error('Finalisasi ditunda: submission durable sedang berjalan'), { statusCode: 409, code: DEFERRED_CODE });
}
export function isDeferredError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === DEFERRED_CODE;
}

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

async function releaseAfterRollback(connection: PoolConnection, error: unknown): Promise<never> {
  try { await connection.rollback(); } catch { /* no active transaction */ }
  throw error;
}

/**
 * TX1: menerima submission manual (finalizeOnly false) atau finalize-only
 * (klien waktu habis). Commit transaksi adalah batas durable acceptance.
 * Jalur idempoten: attempt yang sudah punya exam_results dikembalikan tanpa
 * membuat submission (fast path `submitOnce`, scoring.ts:122-129), dan
 * duplikat ditangani eksplisit via ER_DUP_ENTRY — bukan INSERT IGNORE.
 */
export async function acceptSubmission(
  pool: Pool,
  studentId: number,
  examId: number,
  opts: { finalizeOnly?: boolean } = {},
): Promise<AcceptOutcome> {
  const finalizeOnly = Boolean(opts.finalizeOnly);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [attemptRows] = await connection.execute<RowDataPacket[]>(
      'SELECT id,status,expires_at,termination_action,(expires_at<=UTC_TIMESTAMP(3)) expired FROM exam_attempts WHERE student_id=? AND exam_id=? FOR UPDATE',
      [studentId, examId],
    );
    const attempt = attemptRows[0];
    if (!attempt) throw await releaseAfterRollback(connection, httpError(404, 'Sesi ujian tidak ditemukan'));
    const attemptId = Number(attempt.id);
    const [resultRows] = await connection.execute<RowDataPacket[]>('SELECT 1 existing FROM exam_results WHERE attempt_id=? LIMIT 1', [attemptId]);
    if (resultRows[0]) {
      // Fast path idempotensi: hasil sudah ada → tidak perlu submission baru.
      await connection.commit();
      return { kind: 'result-exists' };
    }
    if (attempt.status === 'TERMINATED' && attempt.termination_action === 'LOCK') {
      throw await releaseAfterRollback(connection, httpError(409, 'Sesi dikunci; pemulihan memerlukan admin'));
    }
    if (finalizeOnly && attempt.status === 'IN_PROGRESS' && !Number(attempt.expired)) {
      throw await releaseAfterRollback(connection, httpError(409, 'Ujian masih aktif'));
    }
    if (!['IN_PROGRESS', 'TERMINATED'].includes(String(attempt.status))) {
      throw await releaseAfterRollback(connection, httpError(409, 'Ujian tidak dapat disubmit'));
    }
    // Freeze marker jawaban: semua autosave berikutnya ditolak (guard kolom
    // pada locking read yang sama; bukti race laporan A2 §2).
    await connection.execute('UPDATE exam_attempts SET submitted_at=UTC_TIMESTAMP(3) WHERE id=? AND submitted_at IS NULL', [attemptId]);
    try {
      await connection.execute(
        "INSERT INTO exam_submissions(attempt_id,student_id,exam_id,state,accepted_status,accepted_expired) VALUES(?,?,?,'RECEIVED',?,?)",
        [attemptId, studentId, examId, String(attempt.status), Number(attempt.expired) ? 1 : 0],
      );
    } catch (error) {
      if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw await releaseAfterRollback(connection, error);
      // Duplikat: baca record yang sudah ada di dalam transaksi yang sama.
      const [existing] = await connection.execute<RowDataPacket[]>(
        'SELECT student_id,exam_id,state,skip_reason FROM exam_submissions WHERE attempt_id=?', [attemptId],
      );
      const row = existing[0];
      await connection.commit();
      if (!row) throw httpError(500, 'Submission tidak ditemukan setelah duplikasi');
      if (Number(row.student_id) !== studentId || Number(row.exam_id) !== examId) {
        throw httpError(500, 'Submission attempt tidak cocok dengan sesi');
      }
      if (row.state === 'DONE') return { kind: 'done' };
      if (row.state === 'RECEIVED' || row.state === 'PROCESSING') return { kind: 'processing', state: String(row.state) };
      return { kind: 'skipped', reason: row.skip_reason ? String(row.skip_reason) : null };
    }
    await connection.commit();
    return { kind: 'accepted' };
  } catch (error) {
    try { await connection.rollback(); } catch { /* no active transaction */ }
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Claim worker: atomik, attempt dikunci dulu (urutan lock global), predikat
 * cap `lease_attempts` ditegakkan di dalam UPDATE sehingga dua worker tidak
 * bisa melewati batas bersamaan (desain A3 §3.1-3.2).
 */
export async function claimSubmission(
  pool: Pool,
  studentId: number,
  examId: number,
  opts: { maxAttempts?: number; leaseMs?: number } = {},
): Promise<ClaimOutcome> {
  const maxAttempts = opts.maxAttempts ?? defaultMaxAttempts;
  const leaseMs = opts.leaseMs ?? defaultLeaseMs;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [attemptRows] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM exam_attempts WHERE student_id=? AND exam_id=? FOR UPDATE', [studentId, examId],
    );
    const attempt = attemptRows[0];
    if (!attempt) {
      await connection.commit();
      return { kind: 'legacy', attemptId: 0, hadResults: false };
    }
    const attemptId = Number(attempt.id);
    const [subRows] = await connection.execute<RowDataPacket[]>(
      'SELECT state,skip_reason FROM exam_submissions WHERE attempt_id=? FOR UPDATE', [attemptId],
    );
    const sub = subRows[0];
    const [hadRows] = await connection.execute<RowDataPacket[]>('SELECT COUNT(*) n FROM exam_results WHERE attempt_id=?', [attemptId]);
    const hadResults = Number(hadRows[0]?.n ?? 0) > 0;
    if (!sub) {
      await connection.commit();
      return { kind: 'legacy', attemptId, hadResults };
    }
    if (sub.state === 'DONE') {
      await connection.commit();
      return { kind: 'skipped', reason: 'done' };
    }
    if (sub.state === 'SKIPPED') {
      await connection.commit();
      return { kind: 'skipped', reason: sub.skip_reason ? String(sub.skip_reason) : 'skipped' };
    }
    const token = randomBytes(16).toString('hex');
    const [claimed] = await connection.execute<ResultSetHeader>(
      `UPDATE exam_submissions SET state='PROCESSING', claim_token=?, lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MICROSECOND),
         lease_attempts=lease_attempts+1, processing_at=COALESCE(processing_at,UTC_TIMESTAMP(3))
       WHERE attempt_id=? AND ((state='RECEIVED' AND lease_attempts<?) OR (state='PROCESSING' AND lease_expires_at<UTC_TIMESTAMP(3) AND lease_attempts<?))`,
      [token, leaseMs * 1000, attemptId, maxAttempts, maxAttempts],
    );
    if (Number(claimed.affectedRows) > 0) {
      // Self-heal freeze marker untuk leftover rollback-window (invariant I1).
      await connection.execute('UPDATE exam_attempts SET submitted_at=COALESCE(submitted_at,UTC_TIMESTAMP(3)) WHERE id=?', [attemptId]);
      const [accRows] = await connection.execute<RowDataPacket[]>(
        'SELECT accepted_status,accepted_expired FROM exam_submissions WHERE attempt_id=?', [attemptId],
      );
      await connection.commit();
      return {
        kind: 'claimed', attemptId, token,
        acceptedExpired: Boolean(Number(accRows[0]?.accepted_expired)),
        acceptedStatus: String(accRows[0]?.accepted_status ?? 'IN_PROGRESS'),
        leaseMs, hadResults,
      };
    }
    // Cap tercapai → SKIPPED sekali (conditional); predikat gagal ⇒ lease valid milik worker lain.
    const [skipped] = await connection.execute<ResultSetHeader>(
      `UPDATE exam_submissions SET state='SKIPPED', skip_reason='lease_exhausted', finalized_at=UTC_TIMESTAMP(3)
       WHERE attempt_id=? AND lease_attempts>=? AND (state='RECEIVED' OR (state='PROCESSING' AND lease_expires_at<UTC_TIMESTAMP(3)))`,
      [attemptId, maxAttempts],
    );
    await connection.commit();
    return Number(skipped.affectedRows) > 0
      ? { kind: 'skipped', reason: 'lease_exhausted' }
      : { kind: 'busy' };
  } catch (error) {
    try { await connection.rollback(); } catch { /* no active transaction */ }
    throw error;
  } finally {
    connection.release();
  }
}

/** Perpanjang lease — hanya owner token yang sah (fencing). */
export async function renewLease(pool: Pool, attemptId: number, token: string, leaseMs: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    "UPDATE exam_submissions SET lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MICROSECOND) WHERE attempt_id=? AND claim_token=? AND state='PROCESSING'",
    [leaseMs * 1000, attemptId, token],
  );
  return Number(result.affectedRows) > 0;
}

export type CompleteOutcome = 'done' | 'taken_over' | 'reset_detected';

/**
 * Finalisasi state submission oleh worker pemegang token.
 * - token cocok + PROCESSING → DONE.
 * - baris hilang (admin reset menghapus submission saat pekerjaan berjalan) →
 *   kembalikan attempt ke kondisi pasca-reset: hapus hasil yang ditulis scoring
 *   kita (hanya dilakukan bila tidak ada hasil sebelum claim — `hadResults`),
 *   status kembali IN_PROGRESS. Worker stale tidak pernah menimpa keputusan reset.
 * - token tidak cocok (diambil alih worker baru) → biarkan; scoring kita yang
 *   sudah commit tetap sah (idempoten) dan worker baru akan konvergen ke DONE.
 */
export async function completeSubmission(
  pool: Pool,
  attemptId: number,
  token: string,
  opts: { claimedHadResults?: boolean } = {},
): Promise<CompleteOutcome> {
  const claimedHadResults = Boolean(opts.claimedHadResults);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [attemptRows] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM exam_attempts WHERE id=? FOR UPDATE', [attemptId],
    );
    const [subRows] = await connection.execute<RowDataPacket[]>(
      'SELECT state,claim_token FROM exam_submissions WHERE attempt_id=? FOR UPDATE', [attemptId],
    );
    const sub = subRows[0];
    if (sub && sub.state === 'PROCESSING' && sub.claim_token === token) {
      await connection.execute(
        "UPDATE exam_submissions SET state='DONE', finalized_at=UTC_TIMESTAMP(3) WHERE attempt_id=? AND claim_token=? AND state='PROCESSING'",
        [attemptId, token],
      );
      await connection.commit();
      return 'done';
    }
    if (!sub && !claimedHadResults) {
      // Reset admin terjadi setelah claim: hapus hasil yang kami tulis dan
      // kembalikan attempt ke kondisi pasca-reset (IN_PROGRESS, tanpa completed_at).
      await connection.execute('DELETE FROM exam_results WHERE attempt_id=?', [attemptId]);
      await connection.execute("UPDATE exam_attempts SET status='IN_PROGRESS', completed_at=NULL WHERE id=?", [attemptId]);
      await connection.commit();
      return 'reset_detected';
    }
    await connection.commit();
    return 'taken_over';
  } catch (error) {
    try { await connection.rollback(); } catch { /* no active transaction */ }
    throw error;
  } finally {
    connection.release();
  }
}

export type SkipOutcome = 'skipped' | 'taken_over' | 'reset_detected';

/** Tandai submission gagal-diproses oleh worker pemegang token (409/404 scoring). */
export async function skipSubmission(
  pool: Pool,
  attemptId: number,
  token: string,
  reason: string,
): Promise<SkipOutcome> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [attemptRows] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM exam_attempts WHERE id=? FOR UPDATE', [attemptId],
    );
    const [result] = await connection.execute<ResultSetHeader>(
      "UPDATE exam_submissions SET state='SKIPPED', skip_reason=?, finalized_at=UTC_TIMESTAMP(3) WHERE attempt_id=? AND claim_token=? AND state='PROCESSING'",
      [reason.slice(0, 100), attemptId, token],
    );
    await connection.commit();
    if (Number(result.affectedRows) > 0) return 'skipped';
    const [subRows] = await pool.execute<RowDataPacket[]>('SELECT 1 existing FROM exam_submissions WHERE attempt_id=?', [attemptId]);
    return subRows[0] ? 'taken_over' : 'reset_detected';
  } catch (error) {
    try { await connection.rollback(); } catch { /* no active transaction */ }
    throw error;
  } finally {
    connection.release();
  }
}

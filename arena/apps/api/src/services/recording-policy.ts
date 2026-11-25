/**
 * Server-side recording policy, storage operational readiness, and
 * transaction-safe recording session orchestration.
 *
 * Readiness semantics:
 * - `storage_configured`: S3 env vars are present and ObjectStorageService instantiated.
 * - `storage_available`: Bounded, cached operational readiness (HeadBucket with 2.5s timeout).
 *   Proves S3 endpoint reachability and bucket permissions without creating objects.
 *   Does NOT issue a HeadBucket per student (single-flight + 30s healthy / 10s unhealthy TTL).
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getObjectStorage, type ObjectStorageService } from './object-storage.js';

export interface RecordingPolicy {
  recording_enabled: boolean;
  recording_required: boolean;
  storage_configured: boolean;
  storage_available: boolean;
  segment_duration_seconds: number;
  video_bitrate: number;
  retention_days: number;
}

const HEALTHY_CACHE_TTL_MS = 30_000;
const UNHEALTHY_CACHE_TTL_MS = 10_000;

let cachedReadiness: { ready: boolean; checkedAt: number } | null = null;
let inFlightProbe: Promise<boolean> | null = null;

export function invalidateStorageReadinessCache(): void {
  cachedReadiness = null;
  inFlightProbe = null;
}

/**
 * Bounded, single-flight cached storage readiness check.
 * Safe for 1,200+ concurrent students: at most 1 HeadBucket probe per TTL window.
 */
export async function checkStorageReadiness(
  storage: ObjectStorageService | null,
  options: { bypassCache?: boolean } = {},
): Promise<boolean> {
  if (!storage) return false;

  // Support lightweight unit-test mocks that don't implement checkBucketReadiness
  if (typeof storage.checkBucketReadiness !== 'function') {
    return true;
  }

  const now = Date.now();
  if (!options.bypassCache && cachedReadiness) {
    const ttl = cachedReadiness.ready ? HEALTHY_CACHE_TTL_MS : UNHEALTHY_CACHE_TTL_MS;
    if (now - cachedReadiness.checkedAt < ttl) {
      return cachedReadiness.ready;
    }
  }

  if (inFlightProbe) return inFlightProbe;

  inFlightProbe = storage
    .checkBucketReadiness(2500)
    .then((res) => {
      cachedReadiness = { ready: res.ready, checkedAt: Date.now() };
      return res.ready;
    })
    .catch(() => {
      cachedReadiness = { ready: false, checkedAt: Date.now() };
      return false;
    })
    .finally(() => {
      inFlightProbe = null;
    });

  return inFlightProbe;
}

export async function getRecordingPolicy(storageOverride?: ObjectStorageService | null): Promise<RecordingPolicy> {
  const recordingEnabled = process.env.RECORDING_ENABLED === 'true';
  const recordingRequired = process.env.RECORDING_REQUIRED === 'true';
  const storage = storageOverride !== undefined ? storageOverride : getObjectStorage();
  const storageConfigured = Boolean(storage);
  const storageAvailable = recordingEnabled && storageConfigured
    ? await checkStorageReadiness(storage)
    : false;

  return {
    recording_enabled: recordingEnabled,
    recording_required: recordingRequired,
    storage_configured: storageConfigured,
    storage_available: storageAvailable,
    segment_duration_seconds: Number(process.env.RECORDING_SEGMENT_DURATION_SECONDS ?? 60),
    video_bitrate: Number(process.env.RECORDING_VIDEO_BITRATE ?? 500_000),
    retention_days: Number(process.env.RECORDING_RETENTION_DAYS ?? 7),
  };
}

/**
 * Fail-closed admission check for waiting/join, waiting/resume, and waiting/claim.
 *
 * When RECORDING_REQUIRED=true:
 * - Rejects if RECORDING_ENABLED is not true.
 * - Rejects if Object Storage is unconfigured or operationally unreachable.
 * - On resume (or when an IN_PROGRESS attempt already exists), ensures no
 *   FINALIZED/ABANDONED recording session blocks resumption.
 */
export async function assertRecordingReadyForAdmission(
  pool: Pool | null,
  studentId: number,
  examId: number,
  options: { storage?: ObjectStorageService | null; checkExistingAttempt?: boolean } = {},
): Promise<RecordingPolicy> {
  const policy = await getRecordingPolicy(options.storage);
  if (!policy.recording_required) {
    return policy;
  }

  if (!policy.recording_enabled) {
    throw Object.assign(
      new Error('Perekaman video wajib untuk ujian ini, tetapi layanan perekaman sedang nonaktif. Hubungi pengawas.'),
      { statusCode: 503, code: 'RECORDING_DISABLED' },
    );
  }

  if (!policy.storage_configured || !policy.storage_available) {
    throw Object.assign(
      new Error('Penyimpanan rekaman ujian tidak tersedia saat ini. Hubungi pengawas.'),
      { statusCode: 503, code: 'RECORDING_STORAGE_UNAVAILABLE' },
    );
  }

  if (options.checkExistingAttempt && pool) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT a.id, a.status attempt_status, rs.status rec_status
       FROM exam_attempts a
       LEFT JOIN exam_recording_sessions rs ON rs.attempt_id = a.id
       WHERE a.student_id = ? AND a.exam_id = ?
       LIMIT 1`,
      [studentId, examId],
    );
    const row = rows[0];
    if (row && row.attempt_status === 'IN_PROGRESS' && row.rec_status && !['ACTIVE', 'INTERRUPTED'].includes(String(row.rec_status))) {
      throw Object.assign(
        new Error('Sesi rekaman ujian sudah ditutup dan tidak dapat dilanjutkan. Hubungi pengawas.'),
        { statusCode: 409, code: 'RECORDING_SESSION_CLOSED' },
      );
    }
  }

  return policy;
}

export function newRecordingPublicId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 26).toUpperCase();
}

/**
 * Ensures an ACTIVE recording session exists for `attemptId` inside an active
 * MySQL transaction. If the transaction rolls back, no orphaned session remains.
 */
export async function ensureRecordingSessionInTransaction(
  connection: PoolConnection,
  studentId: number,
  examId: number,
  attemptId: number,
): Promise<{ session_id: string; resumed: boolean }> {
  const [existing] = await connection.execute<RowDataPacket[]>(
    `SELECT id, public_id, status
     FROM exam_recording_sessions
     WHERE attempt_id = ?
     LIMIT 1
     FOR UPDATE`,
    [attemptId],
  );

  if (existing[0]) {
    const status = String(existing[0].status);
    if (status === 'ACTIVE') {
      return { session_id: String(existing[0].public_id), resumed: true };
    }
    if (status === 'INTERRUPTED') {
      await connection.execute(
        `UPDATE exam_recording_sessions SET status = 'ACTIVE', updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
        [existing[0].id],
      );
      return { session_id: String(existing[0].public_id), resumed: true };
    }
    throw Object.assign(
      new Error('Sesi rekaman sudah difinalisasi atau ditutup'),
      { statusCode: 409, code: 'RECORDING_SESSION_CLOSED' },
    );
  }

  const sessionPublicId = newRecordingPublicId();
  await connection.execute(
    `INSERT INTO exam_recording_sessions
       (public_id, attempt_id, exam_id, student_id, status, started_at)
     VALUES (?, ?, ?, ?, 'ACTIVE', UTC_TIMESTAMP(3))`,
    [sessionPublicId, attemptId, examId, studentId],
  );

  return { session_id: sessionPublicId, resumed: false };
}

/**
 * Transaction-safe, idempotent recording session creation/resumption
 * for an IN_PROGRESS attempt belonging to (studentId, examId).
 */
export async function ensureRecordingSession(
  pool: Pool,
  studentId: number,
  examId: number,
): Promise<{ session_id: string; resumed: boolean }> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [attempts] = await connection.execute<RowDataPacket[]>(
      `SELECT a.id, a.status
       FROM exam_attempts a
       WHERE a.student_id = ? AND a.exam_id = ?
       LIMIT 1
       FOR UPDATE`,
      [studentId, examId],
    );
    if (!attempts[0]) {
      throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 });
    }
    if (attempts[0].status !== 'IN_PROGRESS') {
      throw Object.assign(new Error('Sesi ujian sudah tidak aktif'), { statusCode: 409 });
    }

    const result = await ensureRecordingSessionInTransaction(
      connection,
      studentId,
      examId,
      Number(attempts[0].id),
    );

    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

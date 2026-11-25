/**
 * Recording API routes.
 *
 * Security model:
 * - Only the authenticated student who owns the attempt can create sessions
 *   and upload segments.
 * - Only authorized staff can access playback URLs.
 * - Presigned URLs are short-lived (configurable, default 300s).
 * - Object keys never contain PII.
 * - All staff playback access is audit-logged.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertCsrf, claimsFromRequest } from '../lib/auth.js';
import { requireRole } from '../lib/access.js';
import { requirePool } from '../lib/db.js';
import { waitingRoom } from '../lib/waiting-room.js';
import type { WaitingRoomService } from '../services/waiting-room.js';
import { getObjectStorage, ObjectStorageService } from '../services/object-storage.js';
import {
  ensureRecordingSession,
  getRecordingPolicy,
  getRecordingRuntimeLimits,
} from '../services/recording-policy.js';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const examIdSchema = z.coerce.number().int().positive();

/**
 * Staff access to recording evidence is limited to exams they are assigned to.
 * Global proctors (duty_role=PROCTOR, exam_id NULL) keep their existing access.
 * ADMIN is unrestricted. Mirrors the scope rule used by /api/teacher/live-sessions.
 */
async function assertStaffExamScope(
  pool: Pool,
  claims: { role: string; sub: number },
  examId: number,
): Promise<void> {
  if (claims.role === 'ADMIN') return;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM teacher_exam_assignments x
     JOIN users u ON ((u.teacher_id IS NOT NULL AND u.teacher_id = x.teacher_id)
                   OR (u.employee_id IS NOT NULL AND u.employee_id = x.employee_id))
     WHERE u.id = ? AND u.status = 'ACTIVE'
       AND (x.exam_id = ? OR (x.duty_role = 'PROCTOR' AND x.exam_id IS NULL))
     LIMIT 1`,
    [claims.sub, examId],
  );
  if (!rows[0]) {
    throw Object.assign(new Error('Ujian ini tidak ditugaskan kepada Anda'), { statusCode: 403 });
  }
}

export async function recordingRoutes(
  app: FastifyInstance,
  options: { pool?: Pool; waiting?: WaitingRoomService; storage?: ObjectStorageService | null } = {},
) {
  const waiting = options.waiting ?? waitingRoom;
  const resolvePool = () => options.pool ?? requirePool();

  const authorizeStudent = async (
    request: FastifyRequest,
    examId: number,
    opts: { finished?: boolean; allowBodyToken?: boolean } = {},
  ) => {
    const claims = claimsFromRequest(request);
    if (claims.role !== 'STUDENT') throw Object.assign(new Error('Sesi siswa diperlukan'), { statusCode: 403 });
    const header = request.headers['x-exam-token'];
    const token = typeof header === 'string'
      ? header
      : opts.allowBodyToken && typeof request.body === 'object' && request.body !== null
        ? String((request.body as { exam_token?: string }).exam_token ?? '')
        : '';
    await waiting.authorize(examId, claims.sub, token, opts.finished ?? false);
    assertCsrf(request, claims, { allowBodyToken: opts.allowBodyToken });
    return claims;
  };

  /**
   * GET /api/student/recording/policy
   * Returns backend-configured recording policy (no secrets).
   */
  app.get('/api/student/recording/policy', async (request) => {
    const claims = claimsFromRequest(request);
    if (claims.role !== 'STUDENT') throw Object.assign(new Error('Sesi siswa diperlukan'), { statusCode: 403 });
    return getRecordingPolicy(options.storage);
  });

  if (process.env.RECORDING_ENABLED !== 'true') {
    app.log.info('Recording disabled via RECORDING_ENABLED=false');
    return;
  }

  const storage = options.storage !== undefined ? options.storage : getObjectStorage();
  if (!storage) {
    app.log.warn('Object storage not configured — recording routes will return 503');
  }

  const requireStorage = (): ObjectStorageService => {
    if (!storage) throw Object.assign(new Error('Recording storage not configured'), { statusCode: 503 });
    return storage;
  };

  /**
   * POST /api/student/exams/:id/recording/session
   * Create or resume a recording session for an exam attempt.
   */
  app.post<{ Params: { id: string } }>(
    '/api/student/exams/:id/recording/session',
    async (request) => {
      const store = requireStorage();
      void store;
      const pool = resolvePool();
      const examId = examIdSchema.parse(request.params.id);
      const claims = await authorizeStudent(request, examId);
      return ensureRecordingSession(pool, claims.sub, examId);
    },
  );

  /**
   * POST /api/student/exams/:id/recording/segment
   * Request a presigned URL to upload a recording segment.
   */
  app.post<{ Params: { id: string } }>(
    '/api/student/exams/:id/recording/segment',
    async (request) => {
      const store = requireStorage();
      const pool = resolvePool();
      const examId = examIdSchema.parse(request.params.id);
      const claims = await authorizeStudent(request, examId);
      const limits = getRecordingRuntimeLimits();
      const body = z.object({
        session_id: z.string().length(26),
        sequence_number: z.number().int().min(0).max(limits.max_segments_per_session),
        mime_type: z.string().max(100),
        segment_started_at: z.string().datetime({ offset: true }).optional(),
      }).strict().parse(request.body);

      if (!ObjectStorageService.isAcceptableMimeType(body.mime_type)) {
        throw Object.assign(new Error(`Tipe rekaman tidak didukung: ${body.mime_type}`), { statusCode: 422 });
      }

      // Verify session ownership and that the underlying attempt is still active.
      // Defense-in-depth: waitingRoom.authorize() already checked Redis state,
      // but we also enforce the DB attempt status so stale/finished attempts
      // cannot upload new segments even if their Redis token were somehow reused.
      const [sessions] = await pool.execute<RowDataPacket[]>(
        `SELECT s.id, s.attempt_id, s.status
         FROM exam_recording_sessions s
         JOIN exam_attempts a ON a.id = s.attempt_id
         WHERE s.public_id = ? AND s.student_id = ? AND s.exam_id = ?
           AND a.status = 'IN_PROGRESS'
           AND a.expires_at > UTC_TIMESTAMP(3)
         LIMIT 1`,
        [body.session_id, claims.sub, examId],
      );
      if (!sessions[0]) throw Object.assign(new Error('Sesi rekaman tidak ditemukan atau sesi ujian sudah berakhir'), { statusCode: 404 });
      if (sessions[0].status !== 'ACTIVE') throw Object.assign(new Error('Sesi rekaman tidak aktif'), { statusCode: 409 });

      const sessionDbId = sessions[0].id as number;

      // Check for existing segment (idempotent)
      const [existing] = await pool.execute<RowDataPacket[]>(
        `SELECT id, object_key, upload_status FROM exam_recording_segments
         WHERE session_id = ? AND sequence_number = ? LIMIT 1`,
        [sessionDbId, body.sequence_number],
      );

      let objectKey: string;
      let segmentDbId: number;

      const ext = body.mime_type.includes('mp4') ? 'mp4' : body.mime_type.includes('ogg') ? 'ogg' : 'webm';

      if (existing[0]) {
        objectKey = existing[0].object_key as string;
        segmentDbId = existing[0].id as number;
        // Never mint a fresh PUT URL for evidence that is already confirmed:
        // a student must not be able to overwrite an uploaded segment.
        if (existing[0].upload_status === 'UPLOADED') {
          return {
            segment_id: segmentDbId,
            object_key: objectKey,
            upload_url: '',
            already_uploaded: true,
            expires_in_seconds: 0,
          };
        }
      } else {
        objectKey = ObjectStorageService.buildSegmentKey(
          examId,
          String(sessions[0].attempt_id),
          body.session_id,
          body.sequence_number,
          ext,
        );
        const [result] = await pool.execute<ResultSetHeader>(
          `INSERT INTO exam_recording_segments
             (session_id, sequence_number, object_key, mime_type, upload_status,
              segment_started_at, presigned_expires_at)
           VALUES (?, ?, ?, ?, 'PENDING', ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))`,
          [
            sessionDbId,
            body.sequence_number,
            objectKey,
            body.mime_type,
            body.segment_started_at ? new Date(body.segment_started_at) : null,
            store.uploadUrlExpiresSeconds,
          ],
        );
        segmentDbId = result.insertId;
      }

      const presignedUrl = await store.presignedUploadUrl(objectKey, body.mime_type);

      return {
        segment_id: segmentDbId,
        object_key: objectKey,
        upload_url: presignedUrl,
        expires_in_seconds: store.uploadUrlExpiresSeconds,
      };
    },
  );

  /**
   * PATCH /api/student/exams/:id/recording/segment/:segmentId
   * Confirm a segment was successfully uploaded.
   */
  app.patch<{ Params: { id: string; segmentId: string } }>(
    '/api/student/exams/:id/recording/segment/:segmentId',
    async (request) => {
      const store = requireStorage();
      const pool = resolvePool();
      const examId = examIdSchema.parse(request.params.id);
      const claims = await authorizeStudent(request, examId, { finished: true });
      const segmentId = z.coerce.number().int().positive().parse(request.params.segmentId);
      const body = z.object({
        file_size_bytes: z.number().int().nonnegative().max(500_000_000),
        segment_ended_at: z.string().datetime({ offset: true }).optional(),
      }).strict().parse(request.body);

      // Verify ownership through join chain
      const [segments] = await pool.execute<RowDataPacket[]>(
        `SELECT seg.id, seg.object_key, seg.upload_status, seg.session_id, sess.status session_status
         FROM exam_recording_segments seg
         JOIN exam_recording_sessions sess ON sess.id = seg.session_id
         WHERE seg.id = ? AND sess.student_id = ? AND sess.exam_id = ?
         LIMIT 1`,
        [segmentId, claims.sub, examId],
      );
      if (!segments[0]) throw Object.assign(new Error('Segmen rekaman tidak ditemukan'), { statusCode: 404 });

      const seg = segments[0];
      if (seg.upload_status === 'UPLOADED') {
        return { confirmed: true, already_confirmed: true };
      }
      if (!['ACTIVE', 'INTERRUPTED'].includes(String(seg.session_status))) {
        throw Object.assign(new Error('Sesi rekaman sudah ditutup'), { statusCode: 409 });
      }

      // Strictly verify the uploaded object exists and is non-empty in object storage.
      let head: { contentLength: number } | null = null;
      try {
        head = await store.headObject(seg.object_key as string);
      } catch (error) {
        await pool.execute(
          `UPDATE exam_recording_segments SET upload_status = 'FAILED', retry_count = retry_count + 1 WHERE id = ?`,
          [segmentId],
        ).catch(() => {});
        throw Object.assign(new Error('Gagal memverifikasi segmen di penyimpanan'), { statusCode: 502, cause: error });
      }

      if (!head || head.contentLength <= 0) {
        await pool.execute(
          `UPDATE exam_recording_segments SET upload_status = 'FAILED', retry_count = retry_count + 1 WHERE id = ?`,
          [segmentId],
        );
        throw Object.assign(new Error('Objek rekaman belum ditemukan atau kosong di penyimpanan'), { statusCode: 422 });
      }

      const verifiedSize = head.contentLength;
      const { max_segment_bytes: maxSegmentBytes } = getRecordingRuntimeLimits();

      if (verifiedSize > maxSegmentBytes) {
        // Reject and remove the oversized object so a stuck or malicious
        // recorder cannot accumulate unbounded storage cost. Best-effort:
        // the DB row is still marked FAILED even if the delete call fails.
        await store.deleteObject(seg.object_key as string).catch(() => {});
        await pool.execute(
          `UPDATE exam_recording_segments
           SET upload_status = 'FAILED', retry_count = retry_count + 1
           WHERE id = ?`,
          [segmentId],
        );
        throw Object.assign(
          new Error(`Objek rekaman melebihi batas ${maxSegmentBytes} byte`),
          { statusCode: 413 },
        );
      }

      await pool.execute(
        `UPDATE exam_recording_segments
         SET upload_status = 'UPLOADED',
             file_size_bytes = ?,
             segment_ended_at = ?,
             upload_confirmed_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND upload_status IN ('PENDING', 'FAILED')`,
        [
          verifiedSize,
          body.segment_ended_at ? new Date(body.segment_ended_at) : null,
          segmentId,
        ],
      );

      // Update session uploaded_segments counter
      await pool.execute(
        `UPDATE exam_recording_sessions
         SET uploaded_segments = (
           SELECT COUNT(*) FROM exam_recording_segments
           WHERE session_id = ? AND upload_status = 'UPLOADED'
         ),
         total_segments = (
           SELECT COUNT(*) FROM exam_recording_segments WHERE session_id = ?
         )
         WHERE id = ?`,
        [seg.session_id, seg.session_id, seg.session_id],
      );

      return { confirmed: true };
    },
  );

  /**
   * POST /api/student/exams/:id/recording/finalize
   * Mark the recording session as finalized after exam submission.
   */
  app.post<{ Params: { id: string } }>(
    '/api/student/exams/:id/recording/finalize',
    async (request) => {
      const pool = resolvePool();
      const examId = examIdSchema.parse(request.params.id);
      const claims = await authorizeStudent(request, examId, { finished: true, allowBodyToken: true });
      const body = z.object({
        session_id: z.string().length(26),
        incomplete: z.boolean().optional(),
        csrf_token: z.string().min(32).max(128).optional(),
        exam_token: z.string().max(64).optional(),
      }).strict().parse(request.body);

      const [sessions] = await pool.execute<RowDataPacket[]>(
        `SELECT s.id, s.status FROM exam_recording_sessions s
         WHERE s.public_id = ? AND s.student_id = ? AND s.exam_id = ?
         LIMIT 1`,
        [body.session_id, claims.sub, examId],
      );
      if (!sessions[0]) throw Object.assign(new Error('Sesi rekaman tidak ditemukan'), { statusCode: 404 });
      if (sessions[0].status === 'FINALIZED') {
        return { finalized: true, already_finalized: true };
      }

      const retentionDays = getRecordingRuntimeLimits().retention_days;
      const sessionDbId = sessions[0].id as number;
      const [counts] = await pool.execute<RowDataPacket[]>(
        `SELECT
           COUNT(*) total_cnt,
           COALESCE(SUM(upload_status = 'UPLOADED'), 0) uploaded_cnt,
           COALESCE(SUM(upload_status IN ('PENDING', 'FAILED')), 0) missing_cnt
         FROM exam_recording_segments
         WHERE session_id = ?`,
        [sessionDbId],
      );
      const missingCount = Number(counts[0]?.missing_cnt ?? 0);
      const targetStatus = body.incomplete || missingCount > 0 ? 'INTERRUPTED' : 'FINALIZED';

      await pool.execute(
        `UPDATE exam_recording_sessions
         SET status = ?,
             finalized_at = COALESCE(finalized_at, UTC_TIMESTAMP(3)),
             retain_until = COALESCE(retain_until, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY)),
             cleanup_status = 'PENDING',
             total_segments = ?,
             uploaded_segments = ?,
             missing_segments = ?
         WHERE id = ?`,
        [
          targetStatus,
          retentionDays,
          Number(counts[0]?.total_cnt ?? 0),
          Number(counts[0]?.uploaded_cnt ?? 0),
          missingCount,
          sessionDbId,
        ],
      );

      return { finalized: targetStatus === 'FINALIZED', status: targetStatus, missing_segments: missingCount };
    },
  );

  /**
   * GET /api/teacher/recording/:attemptPublicId
   * List recording segments for an attempt (staff only).
   */
  app.get<{ Params: { attemptPublicId: string } }>(
    '/api/teacher/recording/:attemptPublicId',
    async (request) => {
      const claims = requireRole(request, ['ADMIN', 'TEACHER', 'EMPLOYEE']);
      const pool = resolvePool();

      const attemptPublicId = z.string().length(26).parse(request.params.attemptPublicId);

      const [sessions] = await pool.execute<RowDataPacket[]>(
        `SELECT s.id, s.public_id, s.status, s.started_at, s.finalized_at,
                s.total_segments, s.uploaded_segments, s.missing_segments,
                a.public_id attempt_id, a.exam_id
         FROM exam_recording_sessions s
         JOIN exam_attempts a ON a.id = s.attempt_id
         WHERE a.public_id = ?
         LIMIT 1`,
        [attemptPublicId],
      );
      if (!sessions[0]) return { session: null, segments: [] };

      await assertStaffExamScope(pool, claims, Number(sessions[0].exam_id));

      const [segments] = await pool.execute<RowDataPacket[]>(
        `SELECT id, sequence_number, mime_type, file_size_bytes,
                upload_status, segment_started_at, segment_ended_at, upload_confirmed_at
         FROM exam_recording_segments
         WHERE session_id = ?
         ORDER BY sequence_number ASC`,
        [sessions[0].id],
      );

      return { session: sessions[0], segments };
    },
  );

  /**
   * GET /api/teacher/recording/segment/:segmentId/url
   * Generate a presigned playback URL for a recording segment (staff only).
   * Access is audit-logged.
   */
  app.get<{ Params: { segmentId: string } }>(
    '/api/teacher/recording/segment/:segmentId/url',
    async (request) => {
      const store = requireStorage();
      const claims = requireRole(request, ['ADMIN', 'TEACHER', 'EMPLOYEE']);
      const pool = resolvePool();

      const segmentId = z.coerce.number().int().positive().parse(request.params.segmentId);

      const [segments] = await pool.execute<RowDataPacket[]>(
        `SELECT seg.id, seg.object_key, seg.upload_status, sess.exam_id
         FROM exam_recording_segments seg
         JOIN exam_recording_sessions sess ON sess.id = seg.session_id
         WHERE seg.id = ? AND seg.upload_status = 'UPLOADED' LIMIT 1`,
        [segmentId],
      );
      if (!segments[0]) throw Object.assign(new Error('Segmen tidak tersedia'), { statusCode: 404 });

      await assertStaffExamScope(pool, claims, Number(segments[0].exam_id));

      const seg = segments[0];
      const url = await store.presignedPlaybackUrl(seg.object_key as string);

      // Audit log every access
      const ip = typeof request.ip === 'string' ? request.ip : null;
      await pool.execute(
        `INSERT INTO exam_recording_access_logs
           (segment_id, accessed_by, access_type, ip_address)
         VALUES (?, ?, 'PRESIGNED_URL_GENERATED', ?)`,
        [segmentId, claims.sub, ip],
      ).catch(() => { /* non-fatal */ });

      return { url, expires_in_seconds: store.playbackUrlExpiresSeconds };
    },
  );
}

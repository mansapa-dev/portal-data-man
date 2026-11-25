/**
 * Security event ingestion API.
 *
 * Client sends batches of events; server validates, deduplicates, scores,
 * and persists. Client-submitted severity is never trusted.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCsrf, claimsFromRequest } from '../lib/auth.js';
import { requirePool } from '../lib/db.js';
import { waitingRoom } from '../lib/waiting-room.js';
import { computeEventWeight, classifySeverity } from '../services/risk-scoring.js';
import type { RowDataPacket } from 'mysql2/promise';

const EVENT_TYPES = [
  'TAB_HIDDEN','WINDOW_BLUR','APP_BACKGROUND','PAGE_SUSPENDED','PAGE_RELOADED',
  'FULLSCREEN_EXIT','CLIPBOARD_COPY','CLIPBOARD_PASTE','CONTEXT_MENU',
  'SUSPICIOUS_SHORTCUT','UNEXPECTED_NAVIGATION',
  'CAMERA_PERMISSION_DENIED','CAMERA_OFF','CAMERA_INTERRUPTED','CAMERA_RECOVERED',
  'CAMERA_DEVICE_CHANGED','FACE_ABSENT','MULTIPLE_FACES','FACE_DETECTION_UNAVAILABLE',
  'RECORDING_STARTED','RECORDING_INTERRUPTED','RECORDING_UPLOAD_FAILED',
  'RECORDING_RECOVERED','RECORDING_FINALIZED','RECORDING_MISSING',
  'NETWORK_INTERRUPTED','NETWORK_RECOVERED','ANSWER_SYNC_FAILED','RECORDING_SYNC_FAILED',
  'MULTIPLE_ACTIVE_SESSIONS','SESSION_TOKEN_REUSE','UNAUTHORIZED_SESSION',
  'SUSPICIOUS_REQUEST_RATE','ATTEMPT_STATE_MISMATCH',
] as const;

const eventSchema = z.object({
  event_key: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
  event_type: z.enum(EVENT_TYPES),
  client_occurred_at: z.string().datetime({ offset: true }).optional(),
  duration_ms: z.number().int().nonnegative().max(86_400_000).optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

const batchSchema = z.object({
  attempt_id: z.string().length(26),
  events: z.array(eventSchema).min(1).max(50),
}).strict();

const examIdSchema = z.coerce.number().int().positive();

export async function securityEventRoutes(app: FastifyInstance) {
  /**
   * POST /api/student/exams/:id/security/events
   * Batch ingest security events from the student's browser.
   */
  app.post<{ Params: { id: string } }>(
    '/api/student/exams/:id/security/events',
    async (request) => {
      const pool = requirePool();
      const claims = claimsFromRequest(request);
      if (claims.role !== 'STUDENT') throw Object.assign(new Error('Sesi siswa diperlukan'), { statusCode: 403 });

      const examId = examIdSchema.parse(request.params.id);
      const header = request.headers['x-exam-token'];
      await waitingRoom.authorize(examId, claims.sub, typeof header === 'string' ? header : '', true);
      assertCsrf(request, claims);
      const body = batchSchema.parse(request.body);

      const [attempts] = await pool.execute<RowDataPacket[]>(
        `SELECT a.id, a.status FROM exam_attempts a
         WHERE a.public_id = ? AND a.student_id = ? AND a.exam_id = ?
         LIMIT 1`,
        [body.attempt_id, claims.sub, examId],
      );
      if (!attempts[0]) throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 });

      const attemptDbId = attempts[0].id as number;

      const [countRows] = await pool.execute<RowDataPacket[]>(
        `SELECT event_type, COUNT(*) cnt FROM exam_security_events
         WHERE attempt_id = ? GROUP BY event_type`,
        [attemptDbId],
      );
      const existingCounts = new Map(
        countRows.map((r) => [String(r.event_type), Number(r.cnt)]),
      );

      let totalWeightAdded = 0;
      let inserted = 0;
      let skipped = 0;

      for (const event of body.events) {
        const existing = existingCounts.get(event.event_type) ?? 0;
        const weight = computeEventWeight(event.event_type, existing);
        const severity = classifySeverity(weight);

        try {
          const [res] = await pool.execute<import('mysql2/promise').ResultSetHeader>(
            `INSERT INTO exam_security_events
               (event_key, attempt_id, student_id, exam_id, event_type,
                severity, client_occurred_at, duration_ms, risk_weight, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE id=id`,
            [
              event.event_key,
              attemptDbId,
              claims.sub,
              examId,
              event.event_type,
              severity,
              event.client_occurred_at ? new Date(event.client_occurred_at) : null,
              event.duration_ms ?? null,
              weight,
              event.metadata ? JSON.stringify(event.metadata) : null,
            ],
          );
          if (res.affectedRows === 1) {
            totalWeightAdded += weight;
            inserted += 1;
            existingCounts.set(event.event_type, existing + 1);
          } else {
            skipped += 1;
          }
        } catch {
          skipped += 1;
        }
      }

      if (inserted > 0) {
        const highCount = body.events.filter((e) => classifySeverity(computeEventWeight(e.event_type, 0)) === 'HIGH' || classifySeverity(computeEventWeight(e.event_type, 0)) === 'CRITICAL').length;
        await pool.execute(
          `INSERT INTO exam_attempt_risk_scores (attempt_id, total_score, event_count, high_severity_count, last_event_at)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE
             total_score = total_score + VALUES(total_score),
             event_count = event_count + VALUES(event_count),
             high_severity_count = high_severity_count + VALUES(high_severity_count),
             last_event_at = UTC_TIMESTAMP(3),
             computed_at = UTC_TIMESTAMP(3)`,
          [attemptDbId, totalWeightAdded, inserted, highCount],
        );
      }

      return { accepted: inserted, skipped };
    },
  );

  /**
   * GET /api/teacher/exams/:id/security-events
   * List security events for an exam (staff only).
   */
  app.get<{ Params: { id: string } }>(
    '/api/teacher/exams/:id/security-events',
    async (request) => {
      const pool = requirePool();
      const claims = claimsFromRequest(request);
      if (!['ADMIN','TEACHER','EMPLOYEE'].includes(claims.role)) {
        throw Object.assign(new Error('Akses tidak diizinkan'), { statusCode: 403 });
      }

      const examId = examIdSchema.parse(request.params.id);
      const query = z.object({
        attempt_public_id: z.string().length(26).optional(),
        severity: z.enum(['LOW','MEDIUM','HIGH','CRITICAL']).optional(),
        event_type: z.string().optional(),
        review_status: z.enum(['PENDING','REVIEWED','DISMISSED','ESCALATED']).optional(),
        page: z.coerce.number().int().min(1).max(1000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }).parse(request.query);

      const conditions = ['e.exam_id = ?'];
      const params: Array<string | number> = [examId];

      if (query.attempt_public_id) {
        conditions.push('a.public_id = ?');
        params.push(query.attempt_public_id);
      }
      if (query.severity) { conditions.push('e.severity = ?'); params.push(query.severity); }
      if (query.event_type) { conditions.push('e.event_type = ?'); params.push(query.event_type); }
      if (query.review_status) { conditions.push('e.review_status = ?'); params.push(query.review_status); }

      const where = conditions.join(' AND ');
      params.push(query.limit, (query.page - 1) * query.limit);

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT e.id, e.event_key, e.event_type, e.severity, e.risk_weight,
                e.server_occurred_at, e.client_occurred_at, e.duration_ms,
                e.metadata, e.review_status, e.review_notes, e.reviewed_at,
                s.nisn, s.name_snapshot, s.class_snapshot,
                a.public_id attempt_public_id
         FROM exam_security_events e
         JOIN exam_attempts a ON a.id = e.attempt_id
         JOIN students s ON s.id = e.student_id
         WHERE ${where}
         ORDER BY e.server_occurred_at DESC
         LIMIT ? OFFSET ?`,
        params,
      );

      return { events: rows, page: query.page, limit: query.limit };
    },
  );
}

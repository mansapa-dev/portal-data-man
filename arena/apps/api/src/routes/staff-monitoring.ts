/**
 * Staff monitoring extension routes.
 *
 * These routes ADD to the existing staff.ts routes. They are registered
 * separately to avoid modifying the existing staff.ts file.
 *
 * New routes:
 * - GET /api/teacher/live-sessions-v2  — extended live sessions with device, risk, recording info
 * - GET /api/teacher/security-summary  — risk score summary per exam
 * - PATCH /api/staff/security-events/:id/review — review/classify an incident
 * - GET /api/teacher/exams/:id/risk-scores — risk scores per student
 */
import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { requireRole } from '../lib/access.js';
import { requirePool } from '../lib/db.js';
import { z } from 'zod';

export async function staffMonitoringRoutes(app: FastifyInstance) {
  /**
   * GET /api/teacher/live-sessions-v2
   * Extended live session list including device info, risk score, recording state.
   * Falls back gracefully if new tables don't exist yet.
   */
  app.get('/api/teacher/live-sessions-v2', async (request) => {
    const claims = requireRole(request, ['ADMIN', 'TEACHER', 'EMPLOYEE']);
    const pool = requirePool();
    const query = z.object({
      page: z.coerce.number().int().min(1).max(1000).default(1),
      filter: z.enum([
        'all', 'active', 'camera_unavailable', 'face_absent',
        'recording_interrupted', 'high_risk', 'mobile', 'desktop'
      ]).default('all'),
    }).parse(request.query);

    const admin = claims.role === 'ADMIN';
    const scopeJoin = admin ? '' : ` JOIN teacher_exam_assignments x ON (x.exam_id = e.id OR x.duty_role = 'PROCTOR')
      JOIN users u ON ((u.teacher_id IS NOT NULL AND u.teacher_id = x.teacher_id) OR (u.employee_id IS NOT NULL AND u.employee_id = x.employee_id))
      AND u.id = ${Number(claims.sub)} AND u.status = 'ACTIVE'`;

    const conditions: string[] = ["(a.status = 'IN_PROGRESS' OR (a.status = 'TERMINATED' AND a.updated_at >= UTC_TIMESTAMP(3) - INTERVAL 1 DAY))"];

    if (query.filter === 'active') conditions.push("a.status = 'IN_PROGRESS'");
    if (query.filter === 'face_absent') conditions.push("a.face_status IN ('ABSENT','CAMERA_OFF')");
    if (query.filter === 'mobile') conditions.push("ds.device_category IN ('MOBILE','TABLET')");
    if (query.filter === 'desktop') conditions.push("ds.device_category = 'DESKTOP'");
    if (query.filter === 'high_risk') conditions.push("COALESCE(rs.total_score, 0) >= 20");

    const where = conditions.join(' AND ');
    const params: Array<string | number> = [(query.page - 1) * 100];

    let rows: RowDataPacket[];
    try {
      [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
           a.public_id, a.status, a.started_at, a.expires_at,
           a.violation_count, a.face_status, a.face_absence_started_at,
           s.id student_id, s.nisn, s.name_snapshot, s.class_snapshot,
           e.id exam_id, e.name exam_name, e.grade, e.subject_name,
           c.last_seen_at,
           ds.device_category, ds.browser_family, ds.os_family,
           ds.camera_available, ds.recording_capable,
           COALESCE(rs.total_score, 0) risk_score,
           COALESCE(rs.event_count, 0) security_event_count,
           rs.last_event_at,
           rec.status recording_status, rec.uploaded_segments, rec.total_segments, rec.missing_segments,
           (SELECT COUNT(*) FROM attempt_questions q WHERE q.attempt_id = a.id) total_questions,
           (SELECT COUNT(*) FROM student_answers sa WHERE sa.attempt_id = a.id AND sa.answer IS NOT NULL AND TRIM(sa.answer) <> '') answered_questions
         FROM exam_attempts a
         JOIN students s ON s.id = a.student_id
         JOIN exams e ON e.id = a.exam_id
         LEFT JOIN attempt_connections c ON c.attempt_id = a.id
         LEFT JOIN exam_device_sessions ds ON ds.attempt_id = a.id
         LEFT JOIN exam_attempt_risk_scores rs ON rs.attempt_id = a.id
         LEFT JOIN exam_recording_sessions rec ON rec.attempt_id = a.id
         ${scopeJoin}
         WHERE ${where}
         ORDER BY FIELD(a.status, 'IN_PROGRESS', 'TERMINATED'), COALESCE(rs.total_score,0) DESC, a.updated_at DESC, a.id DESC
         LIMIT 100 OFFSET ?`,
        params,
      );
    } catch (error) {
      // New tables may not exist yet — fall back to basic live-sessions query
      const code = (error as { code?: string }).code ?? '';
      if (code !== 'ER_NO_SUCH_TABLE' && code !== 'ER_BAD_FIELD_ERROR') throw error;
      [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT a.public_id, a.status, a.started_at, a.expires_at,
                a.violation_count, a.face_status, a.face_absence_started_at,
                s.id student_id, s.nisn, s.name_snapshot, s.class_snapshot,
                e.id exam_id, e.name exam_name, e.grade, e.subject_name,
                c.last_seen_at,
                (SELECT COUNT(*) FROM attempt_questions q WHERE q.attempt_id=a.id) total_questions,
                (SELECT COUNT(*) FROM student_answers sa WHERE sa.attempt_id=a.id AND sa.answer IS NOT NULL AND TRIM(sa.answer)<>'') answered_questions
         FROM exam_attempts a
         JOIN students s ON s.id = a.student_id
         JOIN exams e ON e.id = a.exam_id
         LEFT JOIN attempt_connections c ON c.attempt_id = a.id
         WHERE (a.status='IN_PROGRESS' OR (a.status='TERMINATED' AND a.updated_at >= UTC_TIMESTAMP(3) - INTERVAL 1 DAY))
         ORDER BY FIELD(a.status,'IN_PROGRESS','TERMINATED'), a.updated_at DESC, a.id DESC
         LIMIT 100 OFFSET ?`,
        params,
      );
    }

    return rows.map((row) => ({
      ...row,
      total_questions: Number(row.total_questions ?? 0),
      answered_questions: Number(row.answered_questions ?? 0),
      risk_score: Number(row.risk_score ?? 0),
      security_event_count: Number(row.security_event_count ?? 0),
      uploaded_segments: Number(row.uploaded_segments ?? 0),
      total_segments: Number(row.total_segments ?? 0),
      missing_segments: Number(row.missing_segments ?? 0),
    }));
  });

  /**
   * GET /api/teacher/exams/:id/risk-scores
   * Risk score summary per student for a given exam.
   */
  app.get<{ Params: { id: string } }>(
    '/api/teacher/exams/:id/risk-scores',
    async (request) => {
      requireRole(request, ['ADMIN', 'TEACHER', 'EMPLOYEE']);
      const pool = requirePool();
      const examId = z.coerce.number().int().positive().parse(request.params.id);

      let rows: RowDataPacket[];
      try {
        [rows] = await pool.execute<RowDataPacket[]>(
          `SELECT
             a.public_id attempt_public_id, a.status,
             s.nisn, s.name_snapshot, s.class_snapshot,
             rs.total_score, rs.event_count, rs.high_severity_count, rs.last_event_at
           FROM exam_attempts a
           JOIN students s ON s.id = a.student_id
           LEFT JOIN exam_attempt_risk_scores rs ON rs.attempt_id = a.id
           WHERE a.exam_id = ?
           ORDER BY COALESCE(rs.total_score, 0) DESC, a.id ASC`,
          [examId],
        );
      } catch {
        rows = [];
      }

      return rows.map((row) => ({
        ...row,
        total_score: Number(row.total_score ?? 0),
        event_count: Number(row.event_count ?? 0),
        high_severity_count: Number(row.high_severity_count ?? 0),
      }));
    },
  );

  /**
   * PATCH /api/staff/security-events/:id/review
   * Staff review of a security event.
   */
  app.patch<{ Params: { id: string } }>(
    '/api/staff/security-events/:id/review',
    async (request) => {
      const claims = requireRole(request, ['ADMIN', 'TEACHER', 'EMPLOYEE']);
      const pool = requirePool();
      const eventId = z.coerce.number().int().positive().parse(request.params.id);
      const body = z.object({
        review_status: z.enum(['REVIEWED', 'DISMISSED', 'ESCALATED']),
        review_notes: z.string().max(2000).optional(),
      }).strict().parse(request.body);

      try {
        await pool.execute(
          `UPDATE exam_security_events
           SET review_status = ?,
               review_notes = ?,
               reviewed_by = ?,
               reviewed_at = UTC_TIMESTAMP(3)
           WHERE id = ?`,
          [body.review_status, body.review_notes ?? null, claims.sub, eventId],
        );
      } catch (error) {
        const code = (error as { code?: string }).code ?? '';
        if (code === 'ER_NO_SUCH_TABLE') throw Object.assign(new Error('Fitur belum tersedia'), { statusCode: 503 });
        throw error;
      }

      return { reviewed: true };
    },
  );

  /**
   * GET /api/teacher/exams/:id/security-events-summary
   * Quick summary of event types for an exam.
   */
  app.get<{ Params: { id: string } }>(
    '/api/teacher/exams/:id/security-events-summary',
    async (request) => {
      requireRole(request, ['ADMIN', 'TEACHER', 'EMPLOYEE']);
      const pool = requirePool();
      const examId = z.coerce.number().int().positive().parse(request.params.id);

      let rows: RowDataPacket[];
      try {
        [rows] = await pool.execute<RowDataPacket[]>(
          `SELECT event_type, severity, COUNT(*) cnt, COUNT(DISTINCT attempt_id) students
           FROM exam_security_events
           WHERE exam_id = ?
           GROUP BY event_type, severity
           ORDER BY cnt DESC`,
          [examId],
        );
      } catch {
        rows = [];
      }

      return rows.map((row) => ({ ...row, cnt: Number(row.cnt), students: Number(row.students) }));
    },
  );
}

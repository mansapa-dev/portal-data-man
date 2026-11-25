import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCsrf, claimsFromRequest } from '../lib/auth.js';
import { requirePool } from '../lib/db.js';
import { waitingRoom } from '../lib/waiting-room.js';
import type { RowDataPacket } from 'mysql2/promise';

const examIdSchema = z.coerce.number().int().positive();

export async function deviceSessionRoutes(app: FastifyInstance) {
  /**
   * POST /api/student/exams/:id/device-session
   * Report device/browser capabilities at exam start.
   * Data is used for compatibility investigation, not fingerprinting.
   */
  app.post<{ Params: { id: string } }>(
    '/api/student/exams/:id/device-session',
    async (request) => {
      const pool = requirePool();
      const claims = claimsFromRequest(request);
      if (claims.role !== 'STUDENT') throw Object.assign(new Error('Sesi siswa diperlukan'), { statusCode: 403 });

      const examId = examIdSchema.parse(request.params.id);
      const header = request.headers['x-exam-token'];
      await waitingRoom.authorize(examId, claims.sub, typeof header === 'string' ? header : '', true);
      assertCsrf(request, claims);
      const body = z.object({
        attempt_id: z.string().length(26),
        device_category: z.enum(['MOBILE','TABLET','DESKTOP','UNKNOWN']).default('UNKNOWN'),
        browser_family: z.string().max(50).nullable().optional(),
        os_family: z.string().max(50).nullable().optional(),
        screen_width: z.number().int().min(0).max(10000).nullable().optional(),
        screen_height: z.number().int().min(0).max(10000).nullable().optional(),
        camera_available: z.boolean().nullable().optional(),
        recording_capable: z.boolean().nullable().optional(),
        recording_mime_type: z.string().max(100).nullable().optional(),
        fullscreen_capable: z.boolean().nullable().optional(),
        wake_lock_capable: z.boolean().nullable().optional(),
        network_type: z.string().max(30).nullable().optional(),
      }).strict().parse(request.body);

      const [attempts] = await pool.execute<RowDataPacket[]>(
        `SELECT a.id FROM exam_attempts a
         WHERE a.public_id = ? AND a.student_id = ? AND a.exam_id = ?
         LIMIT 1`,
        [body.attempt_id, claims.sub, examId],
      );
      if (!attempts[0]) throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 });

      await pool.execute(
        `INSERT INTO exam_device_sessions
           (attempt_id, device_category, browser_family, os_family,
            screen_width, screen_height, camera_available, recording_capable,
            recording_mime_type, fullscreen_capable, wake_lock_capable, network_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           device_category = VALUES(device_category),
           browser_family = VALUES(browser_family),
           os_family = VALUES(os_family),
           recording_capable = VALUES(recording_capable),
           recording_mime_type = VALUES(recording_mime_type),
           network_type = VALUES(network_type),
           updated_at = UTC_TIMESTAMP(3)`,
        [
          attempts[0].id, body.device_category,
          body.browser_family ?? null, body.os_family ?? null,
          body.screen_width ?? null, body.screen_height ?? null,
          body.camera_available ?? null, body.recording_capable ?? null,
          body.recording_mime_type ?? null, body.fullscreen_capable ?? null,
          body.wake_lock_capable ?? null, body.network_type ?? null,
        ],
      );

      return { recorded: true };
    },
  );
}

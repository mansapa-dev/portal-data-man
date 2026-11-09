import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { requireRole } from '../lib/access.js';
import { requirePool } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { audit } from '../services/audit.js';
import { admissionGroup, ExamAdmissionService } from '../services/exam-admission.js';

export async function examAdmissionRoutes(app: FastifyInstance) {
  const admission = new ExamAdmissionService(redis);
  async function groupForExam(examId: number) {
    const [rows] = await requirePool().execute<RowDataPacket[]>('SELECT academic_year,semester,starts_at,session_number FROM exams WHERE id=?', [examId]);
    const exam = rows[0];
    if (!exam) throw Object.assign(new Error('Ujian tidak ditemukan'), { statusCode: 404 });
    return admissionGroup({ academic_year: exam.academic_year, semester: exam.semester, starts_at: exam.starts_at, session_number: exam.session_number });
  }
  app.get('/api/admin/exam-admission', async (request, reply) => {
    requireRole(request, ['ADMIN']);
    reply.header('Cache-Control', 'no-store');
    const { exam_id } = z.object({ exam_id: z.coerce.number().int().positive() }).strict().parse(request.query);
    return admission.status(await groupForExam(exam_id), 'XII');
  });
  app.post('/api/admin/exam-admission/advance', async (request, reply) => {
    const claims = requireRole(request, ['ADMIN'], true);
    reply.header('Cache-Control', 'no-store');
    const { exam_id, expected_grade } = z.object({ exam_id: z.number().int().positive(), expected_grade: z.enum(['XII', 'XI', 'X']) }).strict().parse(request.body);
    const group = await groupForExam(exam_id);
    const status = await admission.advance(group, expected_grade);
    await audit(requirePool(), claims.sub, claims.role, 'EXAM_ADMISSION_ADVANCED', 'Exam', exam_id, undefined, { group, current_grade: status.current_grade, counts: status.counts });
    return status;
  });
}

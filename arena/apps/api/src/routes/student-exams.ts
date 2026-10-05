import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertCsrf, claimsFromRequest } from '../lib/auth.js';
import { requirePool } from '../lib/db.js';
import { ScoringService } from '../services/scoring.js';
import { StudentExamService } from '../services/student-exam.js';

const examId = z.coerce.number().int().positive();
const answerSchema = z.object({ answer: z.string().max(500).nullable(), is_flagged: z.boolean().default(false), attempt_id: z.string().length(26), base_revision: z.number().int().nonnegative(), mutation_id: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/) }).strict();
const violationSchema = z.object({ event_key: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/), type: z.enum(['TAB_HIDDEN','WINDOW_BLUR','FULLSCREEN_EXIT','SCREENSHOT_ATTEMPT','COPY_ATTEMPT','SPLIT_SCREEN_SUSPECTED','OTHER']) }).strict();

export async function studentExamRoutes(app: FastifyInstance) {
  const pool = requirePool();
  const exams = new StudentExamService(pool);
  const scoring = new ScoringService(pool);
  const studentClaims = (request: FastifyRequest) => {
    const claims = claimsFromRequest(request);
    if (claims.role !== 'STUDENT') throw Object.assign(new Error('Sesi siswa diperlukan'), { statusCode: 403 });
    return claims;
  };
  app.get('/api/student/exams', async (request) => exams.list(studentClaims(request).sub));
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/start', async (request) => {
    const claims = studentClaims(request); assertCsrf(request, claims);
    return exams.start(claims.sub, examId.parse(request.params.id));
  });
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/heartbeat', async (request) => {
    const claims = studentClaims(request); assertCsrf(request, claims);
    return exams.heartbeat(claims.sub, examId.parse(request.params.id));
  });
  app.put<{ Params: { id: string; questionId: string } }>('/api/student/exams/:id/answers/:questionId', async (request) => {
    const claims = studentClaims(request); assertCsrf(request, claims);
    return exams.saveAnswer(claims, examId.parse(request.params.id), examId.parse(request.params.questionId), answerSchema.parse(request.body));
  });
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/violations', async (request) => {
    const claims = studentClaims(request); assertCsrf(request, claims);
    const body = violationSchema.parse(request.body);
    return scoring.recordViolation(claims.sub, examId.parse(request.params.id), body.event_key, body.type);
  });
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/submit', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request) => {
    const claims = studentClaims(request); assertCsrf(request, claims);
    const body = z.object({ finalize_only: z.boolean().optional() }).strict().parse(request.body ?? {});
    return scoring.submit(claims.sub, examId.parse(request.params.id), body.finalize_only ?? false);
  });
  app.get<{ Params: { id: string } }>('/api/student/exams/:id/review', async (request) => scoring.review(studentClaims(request).sub, examId.parse(request.params.id)));
}

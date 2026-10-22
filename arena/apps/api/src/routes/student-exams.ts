import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertCsrf, claimsFromRequest, rateLimitKey, readToken } from '../lib/auth.js';
import { requirePool } from '../lib/db.js';
import { ScoringService } from '../services/scoring.js';
import { StudentExamService } from '../services/student-exam.js';
import type { RowDataPacket } from 'mysql2/promise';

const examId = z.coerce.number().int().positive();
const answerSchema = z.object({ answer: z.string().max(500).nullable(), is_flagged: z.boolean().default(false), attempt_id: z.string().length(26), base_revision: z.number().int().nonnegative(), mutation_id: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/) }).strict();
const violationSchema = z.object({ event_key: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/), type: z.enum(['TAB_HIDDEN','WINDOW_BLUR','FULLSCREEN_EXIT','SCREENSHOT_ATTEMPT','COPY_ATTEMPT','PASTE_ATTEMPT','CUT_ATTEMPT','CONTEXT_MENU_ATTEMPT','DEVTOOLS_SHORTCUT','BROWSER_SHORTCUT','SPLIT_SCREEN_SUSPECTED','MULTI_TAB','TEXT_SELECTION','OTHER']), client_occurred_at: z.string().datetime({ offset: true }).optional(), question_no: z.number().int().nonnegative().max(2000).optional(), csrf_token: z.string().min(32).max(128).optional() }).strict();

export async function studentExamRoutes(app: FastifyInstance) {
  const pool = requirePool();
  const exams = new StudentExamService(pool, app.log);
  app.addHook('onClose', async () => exams.flushDiagnostics());
  const scoring = new ScoringService(pool);
  const studentClaims = (request: FastifyRequest) => {
    const claims = claimsFromRequest(request);
    if (claims.role !== 'STUDENT') throw Object.assign(new Error('Sesi siswa diperlukan'), { statusCode: 403 });
    return claims;
  };
  app.get('/api/student/exams', async (request) => exams.list(studentClaims(request).sub));
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/start', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: rateLimitKey } } }, async (request) => {
    const claims = studentClaims(request); assertCsrf(request, claims);
    return exams.start(claims.sub, examId.parse(request.params.id));
  });
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/heartbeat', { config: { rateLimit: { max: 6, timeWindow: '1 minute', keyGenerator: rateLimitKey } } }, async (request) => {
    const claims = studentClaims(request); assertCsrf(request, claims);
    return exams.heartbeat(claims.sub, examId.parse(request.params.id));
  });
  app.put<{ Params: { id: string; questionId: string } }>('/api/student/exams/:id/answers/:questionId', { config: { rateLimit: { max: 300, timeWindow: '1 minute', keyGenerator: rateLimitKey } } }, async (request) => {
    const claims = studentClaims(request); assertCsrf(request, claims);
    return exams.saveAnswer(claims, examId.parse(request.params.id), examId.parse(request.params.questionId), answerSchema.parse(request.body));
  });
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/violations', { config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: (request) => {
    const bearer=request.headers.authorization?.startsWith('Bearer ')?request.headers.authorization.slice(7):undefined;
    const cookie=request.headers.cookie?.split(';').map((part)=>part.trim()).find((part)=>part.startsWith('arena_student_session='))?.slice('arena_student_session='.length);
    const claims=readToken(bearer??cookie??'');
    const routeId=(request.params as {id:string}).id;
    return claims?.role==='STUDENT'?`violation:student:${claims.sub}:exam:${routeId}`:`violation:ip:${request.ip}`;
  } } } },   async (request) => {
    const claims = studentClaims(request);
    // Violations may arrive via navigator.sendBeacon fallback (no custom headers),
    // so CSRF is additionally accepted inside the body for this endpoint only.
    assertCsrf(request, claims, { allowBodyToken: true });
    const body = violationSchema.parse(request.body);
    return scoring.recordViolation(claims.sub, examId.parse(request.params.id), body.event_key, body.type, { ip: request.ip, userAgent: request.headers['user-agent'] ?? '', clientOccurredAt: body.client_occurred_at ?? null, questionNo: body.question_no });
  });
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/submit', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: rateLimitKey } } }, async (request) => {
    const claims = studentClaims(request); assertCsrf(request, claims);
    const body = z.object({ finalize_only: z.boolean().optional() }).strict().parse(request.body ?? {});
    return scoring.submit(claims.sub, examId.parse(request.params.id), body.finalize_only ?? false);
  });
  app.get<{ Params: { id: string } }>('/api/student/exams/:id/review', async (request) => scoring.review(studentClaims(request).sub, examId.parse(request.params.id)));
  app.get<{ Params: { id: string } }>('/api/student/exams/:id/result', async (request) => {
    const studentId=studentClaims(request).sub,id=examId.parse(request.params.id);
    const [rows]=await pool.execute<RowDataPacket[]>(`SELECT a.status,r.question_count jumlah_soal,r.correct_count benar,r.wrong_count salah,r.blank_count kosong,r.score nilai,m.type follow_up_type FROM exam_attempts a LEFT JOIN exam_results r ON r.attempt_id=a.id LEFT JOIN exam_follow_up_meta m ON m.exam_id=a.exam_id WHERE a.student_id=? AND a.exam_id=? LIMIT 1`,[studentId,id]);
    if(!rows[0])throw Object.assign(new Error('Hasil ujian tidak ditemukan'),{statusCode:404});
    if(rows[0].status==='IN_PROGRESS')throw Object.assign(new Error('Ujian masih berlangsung'),{statusCode:409});
    return rows[0];
  });
}

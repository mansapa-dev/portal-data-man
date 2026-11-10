import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertCsrf, claimsFromRequest, rateLimitKey, readToken } from '../lib/auth.js';
import { requirePool } from '../lib/db.js';
import { ScoringService } from '../services/scoring.js';
import { StudentExamService } from '../services/student-exam.js';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { waitingRoom } from '../lib/waiting-room.js';
import type { WaitingRoomService } from '../services/waiting-room.js';

const examId = z.coerce.number().int().positive();
const answerSchema = z.object({ answer: z.string().max(500).nullable(), is_flagged: z.boolean().default(false), attempt_id: z.string().length(26), base_revision: z.number().int().nonnegative(), mutation_id: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/) }).strict();
const batchAnswersSchema = z.object({ attempt_id: z.string().length(26), answers: z.array(z.object({ question_id: z.number().int().positive(), answer: z.string().max(500).nullable(), is_flagged: z.boolean(), base_revision: z.number().int().nonnegative(), mutation_id: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/) }).strict()).min(1).max(40) }).strict();
const violationSchema = z.object({ event_key: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/), type: z.enum(['TAB_HIDDEN','WINDOW_BLUR','FULLSCREEN_EXIT','SCREENSHOT_ATTEMPT','COPY_ATTEMPT','PASTE_ATTEMPT','CUT_ATTEMPT','CONTEXT_MENU_ATTEMPT','DEVTOOLS_SHORTCUT','BROWSER_SHORTCUT','SPLIT_SCREEN_SUSPECTED','MULTI_TAB','TEXT_SELECTION','APP_OVERLAY','OTHER']), client_occurred_at: z.string().datetime({ offset: true }).optional(), question_no: z.number().int().nonnegative().max(2000).optional(), csrf_token: z.string().min(32).max(128).optional() }).strict();

// Keep the HTTP boundary allowlisted: a future service change must not expose
// correct_answer, option_mapping, or explanation fields to a student.
export const studentStartResponseSchema = {
  type: 'object', additionalProperties: false,
  required: ['attempt_id', 'exam', 'expires_at', 'server_time', 'soal', 'jawaban'],
  properties: {
    attempt_id: { type: 'string' },
    exam: { type: 'object', additionalProperties: false, required: ['id', 'nama_ujian'], properties: { id: { type: 'integer' }, nama_ujian: { type: 'string' } } },
    expires_at: { type: 'string' }, server_time: { type: 'string' },
    soal: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'tipe', 'pertanyaan', 'opsi', 'poin'], properties: {
      id: { type: 'integer' }, tipe: { type: 'string' }, pertanyaan: { type: 'string' }, poin: { type: 'number' },
      opsi: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'text'], properties: { key: { type: 'string' }, text: { type: 'string' } } } },
    } } },
    jawaban: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question_id', 'answer', 'is_flagged', 'revision'], properties: {
      question_id: { type: 'integer' }, answer: { type: ['string', 'null'] }, is_flagged: { type: 'boolean' }, revision: { type: 'integer' },
    } } },
  },
} as const;

export async function studentExamRoutes(app: FastifyInstance, options:{pool?:Pool;waiting?:WaitingRoomService}={}) {
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.split('?')[0]?.startsWith('/api/student/exams')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  const pool = options.pool ?? requirePool();
  const waiting = options.waiting ?? waitingRoom;
  const exams = new StudentExamService(pool, app.log);
  app.addHook('onClose', async () => exams.flushDiagnostics());
  const scoring = new ScoringService(pool);
  const studentClaims = (request: FastifyRequest) => {
    const claims = claimsFromRequest(request);
    if (claims.role !== 'STUDENT') throw Object.assign(new Error('Sesi siswa diperlukan'), { statusCode: 403 });
    return claims;
  };
  const access = async(request:FastifyRequest,exam:number,finished=false,bodyToken=false)=>{
    const claims=studentClaims(request);
    const header=request.headers['x-exam-token'];
    const token=typeof header==='string'?header:bodyToken?String((request.body as {exam_token?:string})?.exam_token ?? ''):'';
    await waiting.authorize(exam,claims.sub,token,finished);
    return claims;
  };
  const claim = async(request:FastifyRequest<{Params:{id:string}}>)=>{
    const claims=studentClaims(request);assertCsrf(request,claims);
    z.object({}).strict().parse(request.body ?? {});
    const exam=examId.parse(request.params.id),header=request.headers['x-exam-token'];
    return waiting.claim(exam,claims.sub,typeof header==='string'?header:'',receipt=>exams.start(claims.sub,exam,0,receipt));
  };
  app.get('/api/student/exams', async (request) => exams.list(studentClaims(request).sub));
  app.get<{ Params: { id: string } }>('/api/student/exams/:id/admission', { config: { rateLimit: { max: 24, timeWindow: '1 minute', keyGenerator: rateLimitKey } } }, async (request) => {
    studentClaims(request);
    throw Object.assign(new Error('Ruang tunggu sudah diperbarui. Muat ulang halaman dari jadwal ujian.'),{statusCode:410});
  });
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/start', { schema: { response: { 200: studentStartResponseSchema } }, config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: rateLimitKey } } }, async (request) => {
    return claim(request);
  });
  app.post<{Params:{id:string}}>('/api/student/exams/:id/waiting/claim',{schema:{response:{200:studentStartResponseSchema}},config:{rateLimit:{max:12,timeWindow:'1 minute',keyGenerator:rateLimitKey}}},claim);
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/heartbeat', { config: { rateLimit: { max: 6, timeWindow: '1 minute', keyGenerator: rateLimitKey } } }, async (request) => {
    const claims = await access(request,examId.parse(request.params.id)); assertCsrf(request, claims);
    return exams.heartbeat(claims.sub, examId.parse(request.params.id));
  });
  app.put<{ Params: { id: string; questionId: string } }>('/api/student/exams/:id/answers/:questionId', { config: { rateLimit: { max: 300, timeWindow: '1 minute', keyGenerator: rateLimitKey } } }, async (request) => {
    const claims = await access(request,examId.parse(request.params.id)); assertCsrf(request, claims);
    return exams.saveAnswer(claims, examId.parse(request.params.id), examId.parse(request.params.questionId), answerSchema.parse(request.body));
  });
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/answers/batch', { config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: rateLimitKey } } }, async (request) => {
    const claims = await access(request,examId.parse(request.params.id)); assertCsrf(request, claims);
    return exams.saveAnswersBatch(claims, examId.parse(request.params.id), batchAnswersSchema.parse(request.body));
  });
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/violations', { config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: (request) => {
    const bearer=request.headers.authorization?.startsWith('Bearer ')?request.headers.authorization.slice(7):undefined;
    const cookie=request.headers.cookie?.split(';').map((part)=>part.trim()).find((part)=>part.startsWith('arena_student_session='))?.slice('arena_student_session='.length);
    const claims=readToken(bearer??cookie??'');
    const routeId=(request.params as {id:string}).id;
    return claims?.role==='STUDENT'?`violation:student:${claims.sub}:exam:${routeId}`:`violation:ip:${request.ip}`;
  } } } },   async (request) => {
    const claims = await access(request,examId.parse(request.params.id),true,true);
    // Violations may arrive via navigator.sendBeacon fallback (no custom headers),
    // so CSRF is additionally accepted inside the body for this endpoint only.
    assertCsrf(request, claims, { allowBodyToken: true });
    const {exam_token: _token,...payload}=z.object({exam_token:z.string().max(64).optional()}).passthrough().parse(request.body);
    const body = violationSchema.parse(payload);
    const result=await scoring.recordViolation(claims.sub, examId.parse(request.params.id), body.event_key, body.type, { ip: request.ip, userAgent: request.headers['user-agent'] ?? '', clientOccurredAt: body.client_occurred_at ?? null, questionNo: body.question_no });
    if(result.terminated)try{await waiting.finish(examId.parse(request.params.id),claims.sub);}catch{app.log.warn('waiting completion deferred');}
    return result;
  });
  app.post<{ Params: { id: string } }>('/api/student/exams/:id/submit', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: rateLimitKey } } }, async (request) => {
    const claims = await access(request,examId.parse(request.params.id),true); assertCsrf(request, claims);
    const body = z.object({ finalize_only: z.boolean().optional() }).strict().parse(request.body ?? {});
    const result=await scoring.submit(claims.sub, examId.parse(request.params.id), body.finalize_only ?? false);
    try{await waiting.finish(examId.parse(request.params.id),claims.sub);}catch{app.log.warn('waiting completion deferred');}
    return result;
  });
  app.get<{ Params: { id: string } }>('/api/student/exams/:id/review', async (request) => scoring.review((await access(request,examId.parse(request.params.id),true)).sub, examId.parse(request.params.id)));
  app.get<{ Params: { id: string } }>('/api/student/exams/:id/result', async (request) => {
    const id=examId.parse(request.params.id),studentId=(await access(request,id,true)).sub;
    const [rows]=await pool.execute<RowDataPacket[]>(`SELECT a.status,r.question_count jumlah_soal,r.correct_count benar,r.wrong_count salah,r.blank_count kosong,r.score nilai,m.type follow_up_type FROM exam_attempts a LEFT JOIN exam_results r ON r.attempt_id=a.id LEFT JOIN exam_follow_up_meta m ON m.exam_id=a.exam_id WHERE a.student_id=? AND a.exam_id=? LIMIT 1`,[studentId,id]);
    if(!rows[0])throw Object.assign(new Error('Hasil ujian tidak ditemukan'),{statusCode:404});
    if(rows[0].status==='IN_PROGRESS')throw Object.assign(new Error('Ujian masih berlangsung'),{statusCode:409});
    return rows[0];
  });
}

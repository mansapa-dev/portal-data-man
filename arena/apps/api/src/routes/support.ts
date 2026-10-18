import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { requireRole } from '../lib/access.js';
import { requirePool } from '../lib/db.js';
import { assertCsrf, claimsFromRequest, readToken } from '../lib/auth.js';
import { resetTerminatedAttemptInTransaction } from '../services/attempt-reset.js';

const ticketCategories = ['ACCOUNT_ACCESS','EXAM_LOCKED','PIN','CONNECTION','TECHNICAL','OTHER'] as const;
async function canHandle(pool: ReturnType<typeof requirePool>, userId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT EXISTS(SELECT 1 FROM teacher_exam_assignments a JOIN users u ON ((u.role='TEACHER' AND u.teacher_id=a.teacher_id) OR (u.role='EMPLOYEE' AND u.employee_id=a.employee_id)) WHERE u.id=? AND u.status='ACTIVE' AND a.duty_role='PROCTOR' AND a.exam_id IS NULL) ok`, [userId]);
  return Boolean(rows[0]?.ok);
}
async function assertActiveActor(connection: PoolConnection, actorId: number, role: string) {
  const [rows] = await connection.execute<RowDataPacket[]>("SELECT id FROM users WHERE id=? AND role=? AND status='ACTIVE' FOR UPDATE", [actorId, role]);
  if (!rows[0]) throw Object.assign(new Error('Akun petugas tidak aktif atau hak akses sudah berubah'), { statusCode: 403 });
}
async function assertActiveProctor(connection: PoolConnection, actorId: number, role: string) {
  if (role === 'ADMIN') return;
  const [rows] = await connection.execute<RowDataPacket[]>(`SELECT EXISTS(
    SELECT 1 FROM teacher_exam_assignments a JOIN users u
      ON ((u.role='TEACHER' AND u.teacher_id=a.teacher_id) OR (u.role='EMPLOYEE' AND u.employee_id=a.employee_id))
    WHERE u.id=? AND u.role=? AND u.status='ACTIVE' AND a.duty_role='PROCTOR' AND a.exam_id IS NULL
  ) allowed`, [actorId, role]);
  if (!rows[0]?.allowed) throw Object.assign(new Error('Hak petugas piket sudah tidak aktif'), { statusCode: 403 });
}
async function writeTicketAudit(connection: PoolConnection, request: FastifyRequest, actorId: number | null, role: string | null, action: string, id: string, before?: unknown, after?: unknown) {
  await connection.execute('INSERT INTO audit_logs(actor_user_id,actor_role,action,entity_type,entity_id,before_data,after_data,ip_address,user_agent) VALUES(?,?,?,?,?,?,?,?,?)', [actorId, role, action, 'SupportTicket', id, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), request.ip.slice(0, 45), String(request.headers['user-agent'] ?? '').slice(0, 500)]);
}
function ticketRateKey(request: FastifyRequest) {
  const bearer = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined;
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('arena_student_session='))?.slice('arena_student_session='.length);
  const claims = readToken(bearer ?? cookie ?? '');
  return claims?.role === 'STUDENT' ? `support-ticket:student:${claims.sub}` : `support-ticket:ip:${request.ip}`;
}
function ulid(){const chars='0123456789ABCDEFGHJKMNPQRSTVWXYZ';let t=Date.now(),s='';for(let i=0;i<10;i++){s=chars[t%32]+s;t=Math.floor(t/32);}for(const x of randomBytes(16))s+=chars[x&31];return s;}
function ticketSelect() { return `SELECT t.public_id id,t.student_id studentId,s.nisn,s.name_snapshot studentName,s.class_snapshot className,t.exam_id examId,e.name examName,t.category,t.message,t.status,t.handled_by,t.staff_note staffNote,t.resolution_type resolutionType,t.created_at createdAt,t.updated_at updatedAt,t.resolved_at resolvedAt,u.name handlerName,a.status attemptStatus,a.violation_count violationCount FROM support_tickets t JOIN students s ON s.id=t.student_id LEFT JOIN exams e ON e.id=t.exam_id LEFT JOIN exam_attempts a ON a.id=t.attempt_id LEFT JOIN users u ON u.id=t.handled_by`; }
export async function supportRoutes(app: FastifyInstance) {
  app.post('/api/student/support-tickets/request', { config: { rateLimit: { max: 5, timeWindow: '5 minutes', keyGenerator: ticketRateKey } } }, async (request) => {
    const hasStudentCredential = request.headers.authorization?.startsWith('Bearer ') || request.headers.cookie?.split(';').some((part) => part.trim().startsWith('arena_student_session='));
    const token=hasStudentCredential?claimsFromRequest(request):null;if(token){if(token.role!=='STUDENT')throw Object.assign(new Error('Sesi siswa diperlukan'),{statusCode:403});assertCsrf(request,token);}
    const body = z.object({ category:z.enum(ticketCategories).default('OTHER'),message:z.string().trim().min(5).max(1000),exam_id:z.number().int().positive().nullable().optional(),nisn:z.string().trim().regex(/^\d{8,20}$/).optional() }).strict().parse(request.body); const pool=requirePool();
    if(!token&&!body.nisn)throw Object.assign(new Error('Masukkan NISN untuk membuat tiket bantuan'),{statusCode:422});
    const connection=await pool.getConnection();let studentId=0,id='';
    try{
      await connection.beginTransaction();
      const[students]=token?await connection.execute<RowDataPacket[]>('SELECT id FROM students WHERE id=? AND is_active=1 FOR UPDATE',[token.sub]):await connection.execute<RowDataPacket[]>('SELECT id FROM students WHERE nisn=? AND is_active=1 FOR UPDATE',[body.nisn??'']);
      studentId=Number(students[0]?.id);if(!studentId)throw Object.assign(new Error('Siswa tidak ditemukan atau tidak aktif'),{statusCode:404});
      let examId=body.exam_id??null;let attemptId:number|null=null;
      if(examId){const[attempts]=await connection.execute<RowDataPacket[]>('SELECT id FROM exam_attempts WHERE student_id=? AND exam_id=?',[studentId,examId]);attemptId=attempts[0]?Number(attempts[0].id):null;
        if(!attemptId){const[eligibility]=await connection.execute<RowDataPacket[]>(`SELECT e.id FROM exams e JOIN students s ON s.id=? WHERE e.id=? AND e.status='ACTIVE' AND e.grade=s.grade_snapshot AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at AND (NOT EXISTS(SELECT 1 FROM exam_target_classes tc0 WHERE tc0.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id=e.id AND tc.portal_class_id=s.portal_class_id)) AND (NOT EXISTS(SELECT 1 FROM exam_target_students ts0 WHERE ts0.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id AND ts.student_id=s.id))`,[studentId,examId]);if(!eligibility[0])throw Object.assign(new Error('Ujian tidak terkait dengan siswa ini'),{statusCode:422});}}
      else if(body.category==='EXAM_LOCKED'){const[attempts]=await connection.execute<RowDataPacket[]>("SELECT id,exam_id FROM exam_attempts WHERE student_id=? AND status='TERMINATED' ORDER BY updated_at DESC,id DESC LIMIT 1",[studentId]);if(attempts[0]){attemptId=Number(attempts[0].id);examId=Number(attempts[0].exam_id);}}
      const[open]=await connection.execute<RowDataPacket[]>(`SELECT public_id id FROM support_tickets WHERE student_id=? AND category=? AND exam_id <=> ? AND status IN ('OPEN','IN_PROGRESS') ORDER BY id DESC LIMIT 1`,[studentId,body.category,examId]);
      if(open[0]){await connection.commit();return open[0];}
      id=ulid();
      await connection.execute('INSERT INTO support_tickets(public_id,student_id,exam_id,attempt_id,category,message) VALUES(?,?,?,?,?,?)',[id,studentId,examId,attemptId,body.category,body.message]);
      await writeTicketAudit(connection, request, null, 'STUDENT', 'SUPPORT_TICKET_CREATED', id, null, { category: body.category, exam_id: examId, status: 'OPEN' });
      await connection.commit();
    }catch(error){try{await connection.rollback();}catch{}throw error;}finally{connection.release();}
    return { id };
  });
  app.get('/api/student/support-tickets', async (request) => { const claims=requireRole(request,['STUDENT']);const [rows]=await requirePool().execute<RowDataPacket[]>(`${ticketSelect()} WHERE t.student_id=? ORDER BY t.updated_at DESC LIMIT 20`,[claims.sub]);return rows; });
  app.get('/api/staff/support-tickets', async (request) => {
    const claims=requireRole(request,['ADMIN','TEACHER','EMPLOYEE']); const query=z.object({status:z.enum(['ALL','OPEN','IN_PROGRESS','RESOLVED','CLOSED']).default('ALL')}).parse(request.query); const pool=requirePool();
    if(claims.role!=='ADMIN'&&!(await canHandle(pool,claims.sub))) throw Object.assign(new Error('Akses tiket hanya untuk petugas piket'),{statusCode:403});
    const where=query.status==='ALL'?'':' AND t.status=?';const params=(query.status==='ALL'?[]:[query.status]) as string[];const [rows]=await pool.execute<RowDataPacket[]>(`${ticketSelect()} WHERE 1=1${where} ORDER BY FIELD(t.status,'OPEN','IN_PROGRESS','RESOLVED','CLOSED'),t.updated_at DESC LIMIT 200`,params);return rows;
  });
  app.post<{Params:{id:string}}>('/api/staff/support-tickets/:id/status', async (request) => {
    const claims=requireRole(request,['ADMIN','TEACHER','EMPLOYEE'],true); const body=z.object({status:z.enum(['OPEN','IN_PROGRESS','RESOLVED','CLOSED']),note:z.string().max(1000).default('')}).strict().parse(request.body);const pool=requirePool();
    if(claims.role!=='ADMIN'&&!(await canHandle(pool,claims.sub))) throw Object.assign(new Error('Fitur tiket hanya untuk admin atau petugas piket'),{statusCode:403});
    if(claims.role!=='ADMIN'&&['OPEN','CLOSED'].includes(body.status)) throw Object.assign(new Error('Petugas hanya dapat mengambil atau menyelesaikan tiket'),{statusCode:403});
    const connection=await pool.getConnection();
    try {
      await connection.beginTransaction(); await assertActiveActor(connection,claims.sub,claims.role); await assertActiveProctor(connection,claims.sub,claims.role);
      const [rows]=await connection.execute<RowDataPacket[]>('SELECT id,status,handled_by FROM support_tickets WHERE public_id=? FOR UPDATE',[request.params.id]);const ticket=rows[0];
      if(!ticket) throw Object.assign(new Error('Tiket tidak ditemukan'),{statusCode:404});
      if(['RESOLVED','CLOSED'].includes(ticket.status)) throw Object.assign(new Error('Tiket sudah ditutup'),{statusCode:409});
      if(ticket.status==='IN_PROGRESS'&&Number(ticket.handled_by)!==claims.sub) throw Object.assign(new Error('Tiket sedang ditangani petugas lain'),{statusCode:409});
      if(body.status==='RESOLVED'&&(ticket.status!=='IN_PROGRESS'||Number(ticket.handled_by)!==claims.sub)) throw Object.assign(new Error('Ambil tiket terlebih dahulu'),{statusCode:409});
      await connection.execute("UPDATE support_tickets SET status=?,handled_by=?,staff_note=?,resolution_type=?,resolved_at=IF(? IN ('RESOLVED','CLOSED'),UTC_TIMESTAMP(3),NULL) WHERE id=?",[body.status,claims.sub,body.note||null,body.status==='RESOLVED'?'ASSISTED':null,body.status,ticket.id]);
      await writeTicketAudit(connection,request,claims.sub,claims.role,'SUPPORT_TICKET_STATUS_CHANGED',request.params.id,{status:ticket.status,handled_by:ticket.handled_by},{status:body.status,handled_by:claims.sub,note:body.note});
      await connection.commit(); return {success:true};
    } catch(error) { try { await connection.rollback(); } catch {} throw error; } finally { connection.release(); }
  });
  app.post<{Params:{id:string}}>('/api/staff/support-tickets/:id/reset', async (request) => {
    const claims=requireRole(request,['ADMIN','TEACHER','EMPLOYEE'],true);const body=z.object({reason:z.string().trim().min(3).max(1000)}).strict().parse(request.body);const pool=requirePool();
    if(claims.role!=='ADMIN'&&!(await canHandle(pool,claims.sub))) throw Object.assign(new Error('Fitur tiket hanya untuk admin atau petugas piket'),{statusCode:403});
    const connection=await pool.getConnection();
    try {
      await connection.beginTransaction(); await assertActiveActor(connection,claims.sub,claims.role); await assertActiveProctor(connection,claims.sub,claims.role);
      const [rows]=await connection.execute<RowDataPacket[]>('SELECT id,student_id,exam_id,status,handled_by FROM support_tickets WHERE public_id=? FOR UPDATE',[request.params.id]);const ticket=rows[0];
      if(!ticket) throw Object.assign(new Error('Tiket tidak ditemukan'),{statusCode:404});
      if(ticket.status!=='IN_PROGRESS'||Number(ticket.handled_by)!==claims.sub)throw Object.assign(new Error('Ambil tiket terlebih dahulu'),{statusCode:409});
      if(!ticket.exam_id)throw Object.assign(new Error('Tiket ini tidak memiliki ujian yang dapat direset'),{statusCode:409});
      const reset=await resetTerminatedAttemptInTransaction(connection,Number(ticket.student_id),Number(ticket.exam_id),{id:claims.sub,role:claims.role},body.reason);
      await connection.execute("UPDATE support_tickets SET status='RESOLVED',staff_note=?,resolution_type='CBT_RESET',resolved_at=UTC_TIMESTAMP(3) WHERE id=?",[body.reason,ticket.id]);
      await writeTicketAudit(connection,request,claims.sub,claims.role,'SUPPORT_TICKET_RESET',request.params.id,{status:ticket.status,resolution_type:null},{status:'RESOLVED',resolution_type:'CBT_RESET',reason:body.reason});
      await connection.commit(); return {reset,ticket:{id:request.params.id,resolutionType:'CBT_RESET'}};
    } catch(error) { try { await connection.rollback(); } catch {} throw error; } finally { connection.release(); }
  });
}

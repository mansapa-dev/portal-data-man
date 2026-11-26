import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { requireRole } from '../lib/access.js';
import { requirePool } from '../lib/db.js';
import { z } from 'zod';
import { resetTerminatedAttempt } from '../services/attempt-reset.js';

export async function staffRoutes(app:FastifyInstance){
 app.get('/api/teacher/dashboard',async(request)=>{
  const claims=requireRole(request,['ADMIN','TEACHER','EMPLOYEE']);const pool=requirePool();const admin=claims.role==='ADMIN';
  const examScope=admin?'':` AND EXISTS(SELECT 1 FROM teacher_exam_assignments x JOIN users u ON u.id=? AND u.status='ACTIVE' AND ((x.teacher_id IS NOT NULL AND x.teacher_id=u.teacher_id) OR (x.employee_id IS NOT NULL AND x.employee_id=u.employee_id)) WHERE x.exam_id=e.id AND x.duty_role IN ('TEACHER','TEACHER_PROCTOR'))`;
  const[exams]=await pool.execute<RowDataPacket[]>(`SELECT e.id,e.name,e.starts_at,e.ends_at,e.status FROM exams e WHERE 1=1${examScope} ORDER BY e.starts_at DESC,e.id DESC LIMIT 100`,admin?[]:[claims.sub]);
  if(!exams.length)return{exams:[]};
  const examIds=exams.map(row=>Number(row.id));const[attemptCounts]=await pool.query<RowDataPacket[]>(`SELECT exam_id,COUNT(*) attempts,COALESCE(SUM(status='IN_PROGRESS'),0) in_progress FROM exam_attempts WHERE exam_id IN (${examIds.map(()=>'?').join(',')}) GROUP BY exam_id`,examIds);
  const counts=new Map(attemptCounts.map(row=>[Number(row.exam_id),{attempts:Number(row.attempts??0),in_progress:Number(row.in_progress??0)}]));
  return{exams:exams.map(exam=>({...exam,...(counts.get(Number(exam.id))??{attempts:0,in_progress:0})}))};
 });
 app.get('/api/teacher/live-sessions',async(request)=>{const claims=requireRole(request,['ADMIN','TEACHER','EMPLOYEE']);const page=z.coerce.number().int().min(1).max(1000).parse((request.query as{page?:string})?.page??1);const admin=claims.role==='ADMIN';const scope=admin?'':' AND EXISTS(SELECT 1 FROM teacher_exam_assignments x JOIN users u ON (u.teacher_id IS NOT NULL AND u.teacher_id=x.teacher_id) OR (u.employee_id IS NOT NULL AND u.employee_id=x.employee_id) WHERE u.id=? AND (x.exam_id=e.id OR (x.duty_role=\'PROCTOR\' AND x.exam_id IS NULL)))';const params=admin?[]:[claims.sub];const[rows]=await requirePool().execute<RowDataPacket[]>(`SELECT a.public_id,a.status,a.started_at,a.expires_at,a.violation_count,s.id student_id,s.nisn,s.name_snapshot,s.class_snapshot,e.id exam_id,e.name exam_name,e.grade,e.subject_name,c.last_seen_at,(SELECT COUNT(*) FROM attempt_questions q WHERE q.attempt_id=a.id) total_questions,(SELECT COUNT(*) FROM student_answers sa WHERE sa.attempt_id=a.id AND sa.answer IS NOT NULL AND TRIM(sa.answer)<>'') answered_questions FROM exam_attempts a JOIN students s ON s.id=a.student_id JOIN exams e ON e.id=a.exam_id LEFT JOIN attempt_connections c ON c.attempt_id=a.id WHERE (a.status='IN_PROGRESS' OR (a.status='TERMINATED' AND a.updated_at >= UTC_TIMESTAMP(3) - INTERVAL 1 DAY))${scope} ORDER BY FIELD(a.status,'IN_PROGRESS','TERMINATED'),a.updated_at DESC,a.id DESC LIMIT 100 OFFSET ?`,[...params,(page-1)*100]);return rows.map(row=>({...row,total_questions:Number(row.total_questions??0),answered_questions:Number(row.answered_questions??0)}));});
 app.get<{Params:{id:string}}>('/api/teacher/exams/:id/results',async(request)=>{const claims=requireRole(request,['ADMIN','TEACHER','EMPLOYEE']);const id=z.coerce.number().int().positive().parse(request.params.id),query=z.object({cursor:z.coerce.number().int().min(0).optional(),limit:z.coerce.number().int().min(1).max(100).default(100)}).parse(request.query),pool=requirePool();if(claims.role!=='ADMIN'){const[allowed]=await pool.execute<RowDataPacket[]>(`SELECT 1 FROM teacher_exam_assignments x JOIN users u ON (u.teacher_id IS NOT NULL AND u.teacher_id=x.teacher_id) OR (u.employee_id IS NOT NULL AND u.employee_id=x.employee_id) WHERE u.id=? AND x.exam_id=? AND x.duty_role IN ('TEACHER','TEACHER_PROCTOR') LIMIT 1`,[claims.sub,id]);if(!allowed.length)throw Object.assign(new Error('Ujian tidak ditugaskan kepada Anda'),{statusCode:403});}const[rows]=await pool.execute<RowDataPacket[]>(`SELECT a.id attempt_row_id,s.id student_id,a.exam_id exam_id,s.nisn,s.name_snapshot,s.class_snapshot,a.status,r.score,r.correct_count,r.wrong_count,r.blank_count,a.completed_at FROM exam_attempts a JOIN students s ON s.id=a.student_id LEFT JOIN exam_results r ON r.attempt_id=a.id WHERE a.exam_id=? AND a.id>? ORDER BY a.id LIMIT ?`,[id,query.cursor??0,query.limit]);const items=rows.map(({attempt_row_id:_,...row})=>row);return{items,next_cursor:rows.length===query.limit?Number(rows[rows.length-1]!.attempt_row_id):null,limit:query.limit};});
 app.get('/api/teacher/subjects',async(request)=>{
  // Portal guru: daftar mapel yang benar-benar ada pada ujian. Tidak memeriksa
  // penugasan pengampu karena satu guru dapat mengampu banyak mapel.
  requireRole(request,['ADMIN','TEACHER','EMPLOYEE']);
  const[rows]=await requirePool().query<RowDataPacket[]>(`SELECT e.subject_name name,COUNT(*) exam_count FROM exams e WHERE e.subject_name IS NOT NULL AND TRIM(e.subject_name)<>'' GROUP BY e.subject_name ORDER BY e.subject_name`);
  return rows.map(row=>({name:String(row.name),exam_count:Number(row.exam_count??0)}));
 });
 app.get('/api/teacher/subject-classes',async(request)=>{
  // Kelas untuk filter rekap mapel. Prioritaskan kelas pada ujian mapel yang
  // ditugaskan ke guru (sesuai pengampu). Bila penugasan belum ada, fallback ke
  // seluruh kelas yang memiliki hasil pada mapel tersebut agar guru tetap bisa
  // mengunduh rekap.
  const claims=requireRole(request,['ADMIN','TEACHER','EMPLOYEE']);
  const query=z.object({subject_name:z.string().trim().min(1).max(100)}).parse(request.query);
  const pool=requirePool();
  const mapRows=(rows:RowDataPacket[])=>rows.map(row=>({name:String(row.name),result_count:Number(row.result_count??0)}));
  if(claims.role!=='ADMIN'){
    const[assigned]=await pool.execute<RowDataPacket[]>(`SELECT DISTINCT s.class_snapshot name,COUNT(*) result_count FROM exam_attempts a JOIN students s ON s.id=a.student_id JOIN exams e ON e.id=a.exam_id JOIN teacher_exam_assignments x ON x.exam_id=e.id JOIN users u ON u.id=? AND ((x.teacher_id IS NOT NULL AND x.teacher_id=u.teacher_id) OR (x.employee_id IS NOT NULL AND x.employee_id=u.employee_id)) WHERE e.subject_name=? AND s.class_snapshot IS NOT NULL AND TRIM(s.class_snapshot)<>'' GROUP BY s.class_snapshot ORDER BY s.class_snapshot`,[claims.sub,query.subject_name]);
    if(assigned.length) return{items:mapRows(assigned),scoped:true};
  }
  const[rows]=await pool.execute<RowDataPacket[]>(`SELECT DISTINCT s.class_snapshot name,COUNT(*) result_count FROM exam_attempts a JOIN students s ON s.id=a.student_id JOIN exams e ON e.id=a.exam_id WHERE e.subject_name=? AND s.class_snapshot IS NOT NULL AND TRIM(s.class_snapshot)<>'' GROUP BY s.class_snapshot ORDER BY s.class_snapshot`,[query.subject_name]);
  return{items:mapRows(rows),scoped:false};
 });
 app.get('/api/teacher/results-by-subject',async(request)=>{
  // Rekap nilai lintas ujian untuk satu mapel. Akses sengaja TIDAK memakai
  // teacher_exam_assignments sebagai hard filter: penugasan per-ujian sering
  // tidak lengkap padahal guru mengampu banyak mapel. class_name opsional untuk
  // filter kelas.
  requireRole(request,['ADMIN','TEACHER','EMPLOYEE']);
  const query=z.object({subject_name:z.string().trim().min(1).max(100),class_name:z.string().trim().min(1).max(100).optional(),cursor:z.coerce.number().int().min(0).optional(),limit:z.coerce.number().int().min(1).max(200).default(200)}).parse(request.query);
  const classFilter=query.class_name?' AND s.class_snapshot=?':'';
  const params:(string|number)[]=[query.subject_name];
  if(query.class_name) params.push(query.class_name);
  params.push(query.cursor??0,query.limit);
  const[rows]=await requirePool().execute<RowDataPacket[]>(`SELECT a.id attempt_row_id,s.id student_id,a.exam_id,e.name exam_name,e.subject_name,e.grade,s.nisn,s.name_snapshot,s.class_snapshot,a.status,r.score,r.correct_count,r.wrong_count,r.blank_count,a.completed_at FROM exam_attempts a JOIN students s ON s.id=a.student_id JOIN exams e ON e.id=a.exam_id LEFT JOIN exam_results r ON r.attempt_id=a.id WHERE e.subject_name=?${classFilter} AND a.id>? ORDER BY a.id LIMIT ?`,params);
  const items=rows.map(({attempt_row_id:_,...row})=>row);
  return{items,next_cursor:rows.length===query.limit?Number(rows[rows.length-1]!.attempt_row_id):null,limit:query.limit};
 });
 app.get('/api/staff/violations',async(request)=>{
  const claims=requireRole(request,['ADMIN','TEACHER','EMPLOYEE']);
  const query=z.object({
    page:z.coerce.number().int().min(1).max(1000).default(1),
    limit:z.coerce.number().int().min(1).max(200).default(100),
    exam_id:z.coerce.number().int().positive().optional(),
    grade:z.string().trim().max(10).optional(),
    class_name:z.string().trim().max(100).optional(),
    class_id:z.string().trim().max(64).optional(),
    type:z.string().trim().max(40).optional(),
    q:z.string().trim().max(120).optional(),
  }).parse(request.query);
  const admin=claims.role==='ADMIN';
  const scope=admin?'':' AND EXISTS(SELECT 1 FROM teacher_exam_assignments x JOIN users u ON (u.teacher_id IS NOT NULL AND u.teacher_id=x.teacher_id) OR (u.employee_id IS NOT NULL AND u.employee_id=x.employee_id) WHERE u.id=? AND (x.exam_id=e.id OR (x.duty_role=\'PROCTOR\' AND x.exam_id IS NULL)))';
  const filters:string[]=[];const params:(string|number)[]=admin?[]:[claims.sub];
  if(query.exam_id){filters.push('a.exam_id=?');params.push(query.exam_id);}
  if(query.grade){filters.push('s.grade_snapshot=?');params.push(query.grade);}
  if(query.class_name){filters.push('s.class_snapshot=?');params.push(query.class_name);}
  if(query.class_id){filters.push('s.portal_class_id=?');params.push(query.class_id);}
  if(query.type){filters.push('v.type=?');params.push(query.type);}
  if(query.q){filters.push('(s.nisn LIKE ? OR s.name_snapshot LIKE ? OR e.name LIKE ?)');params.push(`%${query.q}%`,`%${query.q}%`,`%${query.q}%`);}
  const where=`WHERE 1=1${scope}${filters.length?` AND ${filters.join(' AND ')}`:''}`;
  const[rows]=await requirePool().execute<RowDataPacket[]>(`SELECT v.id,v.type,v.event_key,v.occurred_at,a.status attempt_status,a.violation_count,e.id exam_id,e.name exam_name,e.grade exam_grade,s.id student_id,s.nisn,s.name_snapshot,s.class_snapshot,s.grade_snapshot FROM violations v JOIN exam_attempts a ON a.id=v.attempt_id JOIN exams e ON e.id=a.exam_id JOIN students s ON s.id=a.student_id ${where} ORDER BY v.occurred_at DESC,v.id DESC LIMIT ? OFFSET ?`,[...params,query.limit,(query.page-1)*query.limit]);
  return rows;
 });
   app.get('/api/staff/face-absence',async(request)=>{
   const claims=requireRole(request,['ADMIN','TEACHER','EMPLOYEE']);
   const query=z.object({
     page:z.coerce.number().int().min(1).max(1000).default(1),
     limit:z.coerce.number().int().min(1).max(200).default(100),
     exam_id:z.coerce.number().int().positive().optional(),
     grade:z.string().trim().max(10).optional(),
     class_name:z.string().trim().max(100).optional(),
   }).parse(request.query);
   const admin=claims.role==='ADMIN';
   // ADMIN melihat semua peserta. Guru/petugas hanya ujian yang ditugaskan,
   // ditambah pengawas global (duty_role=PROCTOR, exam_id NULL) yang mencakup
   // seluruh ujian.
   const scope=admin?'':' AND EXISTS(SELECT 1 FROM teacher_exam_assignments x JOIN users u ON (u.teacher_id IS NOT NULL AND u.teacher_id=x.teacher_id) OR (u.employee_id IS NOT NULL AND u.employee_id=x.employee_id) WHERE u.id=? AND (x.exam_id=e.id OR (x.duty_role=\'PROCTOR\' AND x.exam_id IS NULL)))';
   const params:(string|number)[]=admin?[]:[claims.sub];
   // Hanya attempt aktif dan hanya status wajah yang benar-benar bermasalah.
   const filters:string[]=["a.status='IN_PROGRESS'","a.face_status IN ('ABSENT','CAMERA_OFF')"];
   if(query.exam_id){filters.push('a.exam_id=?');params.push(query.exam_id);}
   if(query.grade){filters.push('s.grade_snapshot=?');params.push(query.grade);}
   if(query.class_name){filters.push('s.class_snapshot=?');params.push(query.class_name);}
   const where=`WHERE ${filters.join(' AND ')}${scope}`;
   // Durasi dihitung oleh MySQL terhadap UTC_TIMESTAMP(3), bukan jam proses API,
   // sehingga konsisten dengan waktu penyimpanan dan tidak terpengaruh zona waktu
   // perangkat siswa maupun server aplikasi.
   const[rows]=await requirePool().execute<RowDataPacket[]>(`SELECT a.public_id,a.face_status,a.face_absence_started_at,a.violation_count,COALESCE(TIMESTAMPDIFF(SECOND,a.face_absence_started_at,UTC_TIMESTAMP(3)),0) absence_seconds,s.id student_id,s.nisn,s.name_snapshot,s.class_snapshot,s.grade_snapshot,e.id exam_id,e.name exam_name,e.grade,e.subject_name,c.last_seen_at FROM exam_attempts a JOIN students s ON s.id=a.student_id JOIN exams e ON e.id=a.exam_id LEFT JOIN attempt_connections c ON c.attempt_id=a.id ${where} ORDER BY a.face_absence_started_at ASC,a.id DESC LIMIT ? OFFSET ?`,[...params,query.limit,(query.page-1)*query.limit]);
   return rows.map((row:RowDataPacket)=>({...row,absence_seconds:Number(row.absence_seconds??0),absence_minutes:Math.floor(Number(row.absence_seconds??0)/60)}));
  });
app.post<{Params:{id:string}}>('/api/staff/students/:id/reset',async(request)=>{const claims=requireRole(request,['ADMIN','TEACHER','EMPLOYEE'],true);if(!/^\d+$/.test(String(request.params.id)))throw Object.assign(new Error('ID siswa tidak valid'),{statusCode:400});const body=z.object({exam_id:z.coerce.number().int().positive(),reason:z.string().trim().min(3).max(1000)}).strict().parse(request.body),studentId=z.coerce.number().int().positive().parse(request.params.id);return resetTerminatedAttempt(requirePool(),studentId,body.exam_id,claims.sub,claims.role,body.reason);});
// Reset NILAI: khusus attempt yang sudah selesai. Jawaban lama dihapus, attempt
// diberi durasi penuh baru dari exams.duration_minutes sehingga tetap bisa
// dikerjakan walau jadwal ujian sudah tutup. Hak akses (admin/petugas piket)
// divalidasi di dalam service agar konsisten dengan reset sesi biasa.
app.post<{Params:{id:string}}>('/api/staff/students/:id/reset-score',async(request)=>{const claims=requireRole(request,['ADMIN','TEACHER','EMPLOYEE'],true);if(!/^\d+$/.test(String(request.params.id)))throw Object.assign(new Error('ID siswa tidak valid'),{statusCode:400});const body=z.object({exam_id:z.coerce.number().int().positive(),reason:z.string().trim().min(3).max(1000)}).strict().parse(request.body),studentId=z.coerce.number().int().positive().parse(request.params.id);return resetTerminatedAttempt(requirePool(),studentId,body.exam_id,claims.sub,claims.role,body.reason,{clearAnswers:true,restartFullDuration:true,requireFinished:true});});
}

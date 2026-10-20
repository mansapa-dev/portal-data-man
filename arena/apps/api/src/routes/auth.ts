import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePool } from '../lib/db.js';
import { assertCsrf, claimsFromRequest, issueToken, newCsrf, normalizeStudentDigits, studentLoginRateLimitKey } from '../lib/auth.js';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { audit } from '../services/audit.js';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { staffCapabilities } from '../services/staff-capabilities.js';
import { verifyPassword, verifyPasswordDetails, getVerifierStats } from '../services/password-verifier.js';
import { refundStudentLoginRateLimit } from '../lib/rate-limit-store.js';

const loginSchema = z.object({ nisn: z.string().trim().min(8).max(20), pin: z.string().trim().min(4).max(12) }).strict();
const studentSessionSeconds=12*60*60;
const loginInFlight = new Map<string,Promise<{token:string;csrf_token:string;expires_in:number;student:Record<string,unknown>}>>();
export const studentLoginRateLimit = { max: 20, timeWindow: '10 minutes', keyGenerator: (request: { body: unknown }) => studentLoginRateLimitKey(request.body) };

type LoginOutcome='success'|'invalid_credentials'|'invalid_input'|'queue_overload'|'database_error'|'error';
function percentile(values:number[],percent:number){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return Number(sorted[Math.ceil(percent*sorted.length)-1]!.toFixed(1));}

export async function authRoutes(app: FastifyInstance) {
  const diagnosticsEnabled=process.env.ARENA_LOGIN_DIAGNOSTICS==='true';
  const metrics={
    startedAt:Date.now(),
    requests:0,
    success:0,
    invalidCredentials:0,
    invalidInput:0,
    queueOverload:0,
    databaseErrors:0,
    errors:0,
    deduplicated:0,
    poolWaitMs:[] as number[],
    lookupMs:[] as number[],
    queueWaitMs:[] as number[],
    bcryptMs:[] as number[],
    totalMs:[] as number[]
  };
  let metricsTimer:NodeJS.Timeout|undefined;
  const flushMetrics=()=>{
    if(!diagnosticsEnabled||!metrics.requests)return;
    const verifierStats = getVerifierStats();
    app.log.info({
      event:'student_login_metrics',
      window_ms:Date.now()-metrics.startedAt,
      requests:metrics.requests,
      success:metrics.success,
      invalid_credentials:metrics.invalidCredentials,
      invalid_input:metrics.invalidInput,
      queue_overload:metrics.queueOverload,
      database_errors:metrics.databaseErrors,
      errors:metrics.errors,
      deduplicated:metrics.deduplicated,
      pool_wait_ms:{p50:percentile(metrics.poolWaitMs,.50),p95:percentile(metrics.poolWaitMs,.95),p99:percentile(metrics.poolWaitMs,.99)},
      lookup_ms:{p50:percentile(metrics.lookupMs,.50),p95:percentile(metrics.lookupMs,.95),p99:percentile(metrics.lookupMs,.99)},
      queue_wait_ms:{p50:percentile(metrics.queueWaitMs,.50),p95:percentile(metrics.queueWaitMs,.95),p99:percentile(metrics.queueWaitMs,.99)},
      bcrypt_compute_ms:{p50:percentile(metrics.bcryptMs,.50),p95:percentile(metrics.bcryptMs,.95),p99:percentile(metrics.bcryptMs,.99)},
      total_ms:{p50:percentile(metrics.totalMs,.50),p95:percentile(metrics.totalMs,.95),p99:percentile(metrics.totalMs,.99)},
      verifier:verifierStats
    },'student login diagnostic window');
    metrics.startedAt=Date.now();metrics.requests=0;metrics.success=0;metrics.invalidCredentials=0;metrics.invalidInput=0;metrics.queueOverload=0;metrics.databaseErrors=0;metrics.errors=0;metrics.deduplicated=0;metrics.poolWaitMs=[];metrics.lookupMs=[];metrics.queueWaitMs=[];metrics.bcryptMs=[];metrics.totalMs=[];
  };
  const recordMetrics=(outcome:LoginOutcome,duration:number,poolWait:number,lookup:number,queueWait:number,bcrypt:number,deduplicated:boolean)=>{
    if(!diagnosticsEnabled)return;
    if(!metrics.requests)metrics.startedAt=Date.now();
    metrics.requests++;
    if(outcome==='success')metrics.success++;
    else if(outcome==='invalid_credentials')metrics.invalidCredentials++;
    else if(outcome==='invalid_input')metrics.invalidInput++;
    else if(outcome==='queue_overload')metrics.queueOverload++;
    else if(outcome==='database_error')metrics.databaseErrors++;
    else metrics.errors++;

    if(deduplicated)metrics.deduplicated++;
    if(!deduplicated){
      if(poolWait>0)metrics.poolWaitMs.push(poolWait);
      if(lookup>0)metrics.lookupMs.push(lookup);
      if(queueWait>0)metrics.queueWaitMs.push(queueWait);
      if(bcrypt>0)metrics.bcryptMs.push(bcrypt);
    }
    metrics.totalMs.push(duration);
    if(!metricsTimer){metricsTimer=setTimeout(()=>{metricsTimer=undefined;flushMetrics();},60_000);metricsTimer.unref();}
    if(metrics.requests>=2048){if(metricsTimer)clearTimeout(metricsTimer);metricsTimer=undefined;flushMetrics();}
  };
  app.addHook('onClose',async()=>{if(metricsTimer)clearTimeout(metricsTimer);flushMetrics();});

  app.get('/api/diagnostics/auth', async () => {
    return {
      verifier: getVerifierStats(),
      diagnosticsEnabled,
      metricsSnapshot: {
        window_ms: Date.now() - metrics.startedAt,
        requests: metrics.requests,
        success: metrics.success,
        invalid_credentials: metrics.invalidCredentials,
        queue_overload: metrics.queueOverload,
        database_errors: metrics.databaseErrors,
        errors: metrics.errors,
        deduplicated: metrics.deduplicated,
      }
    };
  });

  app.post('/api/auth/student/login', {
    config: { rateLimit: studentLoginRateLimit },
  }, async (request, reply) => {
    const started=performance.now();let poolWaitMs=0,lookupMs=0,queueWaitMs=0,bcryptMs=0,deduplicated=false,outcome:LoginOutcome='error';
    let rateKey: string | undefined;
    try{
      const body = loginSchema.parse(request.body);
      const nisn = normalizeStudentDigits(body.nisn); const pin = normalizeStudentDigits(body.pin);
      if (!/^\d{8,20}$/.test(nisn) || !/^\d{4,12}$/.test(pin)) throw Object.assign(new Error('NISN atau PIN tidak valid'), { statusCode: 422 });
      rateKey = studentLoginRateLimitKey(body);
      const requestKey=createHash('sha256').update(`${process.env.AUTH_TOKEN_SECRET??'local-development-only'}:${nisn}:${pin}`).digest('hex');
      const previous=loginInFlight.get(requestKey);
      if(previous){
        deduplicated=true;const response=await previous;outcome='success';
        reply.header('Set-Cookie',`arena_student_session=${response.token}; Path=/; Max-Age=${studentSessionSeconds}; HttpOnly; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`);reply.header('Cache-Control','no-store');return response;
      }
      const task=(async()=>{
        const pool=requirePool();const acquireStarted=performance.now();let connection:PoolConnection;
        try{connection=await pool.getConnection();}catch{throw Object.assign(new Error('Koneksi basis data sedang sibuk. Coba lagi sebentar.'),{statusCode:503,retryAfter:2});}finally{poolWaitMs=performance.now()-acquireStarted;}
        let rows:RowDataPacket[];
        try{const queryStarted=performance.now();try{[rows]=await connection.execute<RowDataPacket[]>('SELECT id,nisn,name_snapshot,class_snapshot,grade_snapshot,pin_hash,cbt_status FROM students WHERE nisn=? AND is_active=1 LIMIT 1',[nisn]);}finally{lookupMs=performance.now()-queryStarted;}}
        finally{connection.release();}
        const student=rows![0];let valid=false;
        if(student?.cbt_status==='ACTIVE'&&typeof student.pin_hash==='string'){
          const signal = (request.raw as { signal?: AbortSignal }).signal;
          const verResult=await verifyPasswordDetails(pin,student.pin_hash,signal);
          valid=verResult.valid;queueWaitMs=verResult.queueWaitMs;bcryptMs=verResult.computeMs;
        }
        if(!valid||!student)throw Object.assign(new Error('NISN atau PIN salah'),{statusCode:401});
        const csrf=newCsrf();const token=issueToken({sub:Number(student.id),role:'STUDENT',exp:Math.floor(Date.now()/1000)+studentSessionSeconds,csrf});
        return{token,csrf_token:csrf,expires_in:studentSessionSeconds,student:{id:Number(student.id),nisn:student.nisn,nama:student.name_snapshot,kelas:student.class_snapshot,tingkat:student.grade_snapshot}};
      })();
      loginInFlight.set(requestKey,task);
      try{const response=await task;outcome='success';reply.header('Set-Cookie',`arena_student_session=${response.token}; Path=/; Max-Age=${studentSessionSeconds}; HttpOnly; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`);reply.header('Cache-Control','no-store');return response;}
      finally{if(loginInFlight.get(requestKey)===task)loginInFlight.delete(requestKey);}
    }catch(error){
      const status=(error as{statusCode?:number})?.statusCode,code=(error as{code?:string})?.code;
      const retryAfter=(error as{retryAfter?:number})?.retryAfter??2;
      if(status===503){
        reply.header('Retry-After',String(retryAfter));
        if(rateKey)refundStudentLoginRateLimit(rateKey);
      }
      outcome=error instanceof z.ZodError||status===422?'invalid_input':status===401?'invalid_credentials':status===503?'queue_overload':code&&(/^(ER_|PROTOCOL_|POOL_|ECONN|ETIMEDOUT)/.test(code))?'database_error':'error';
      throw error;
    }
    finally{recordMetrics(outcome,performance.now()-started,poolWaitMs,lookupMs,queueWaitMs,bcryptMs,deduplicated);}
  });
  app.get('/api/auth/student/session', async (request,reply) => {
    const claims=claimsFromRequest(request);if(claims.role!=='STUDENT')throw Object.assign(new Error('Sesi siswa diperlukan'),{statusCode:403});
    const[rows]=await requirePool().execute<RowDataPacket[]>('SELECT id,nisn,name_snapshot,class_snapshot,grade_snapshot,cbt_status FROM students WHERE id=? AND is_active=1 LIMIT 1',[claims.sub]);const student=rows[0];
    if(!student||student.cbt_status!=='ACTIVE')throw Object.assign(new Error('Akun siswa tidak aktif'),{statusCode:401});
    const token=issueToken({sub:claims.sub,role:'STUDENT',exp:Math.floor(Date.now()/1000)+studentSessionSeconds,csrf:claims.csrf});reply.header('Set-Cookie',`arena_student_session=${token}; Path=/; Max-Age=${studentSessionSeconds}; HttpOnly; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`);reply.header('Cache-Control','no-store');return{csrf_token:claims.csrf,expires_in:studentSessionSeconds,student:{id:Number(student.id),nisn:student.nisn,nama:student.name_snapshot,kelas:student.class_snapshot,tingkat:student.grade_snapshot}};
  });
  app.get('/api/auth/me', async (request) => {
    const claims = claimsFromRequest(request);
    if (claims.role === 'STUDENT') {
      const [rows] = await requirePool().execute<RowDataPacket[]>('SELECT id,nisn,name_snapshot,class_snapshot,grade_snapshot,cbt_status FROM students WHERE id=? AND is_active=1 LIMIT 1', [claims.sub]);
      const student = rows[0];
      if (!student || student.cbt_status !== 'ACTIVE') throw Object.assign(new Error('Akun siswa tidak aktif'), { statusCode: 401 });
      return { student: { id: Number(student.id), nisn: student.nisn, nama: student.name_snapshot, kelas: student.class_snapshot, tingkat: student.grade_snapshot, cbt_status: student.cbt_status }, csrf_token: claims.csrf };
    }
    const [rows] = await requirePool().execute<RowDataPacket[]>('SELECT id,username,name,role,status FROM users WHERE id=? LIMIT 1',[claims.sub]);
    const staff=rows[0];if(!staff||staff.status!=='ACTIVE'||staff.role!==claims.role)throw Object.assign(new Error('Akun personel tidak aktif'),{statusCode:401});
    return { staff:{id:Number(staff.id),username:staff.username,nama:staff.name,role:staff.role,capabilities:await staffCapabilities(requirePool(),Number(staff.id),staff.role)},csrf_token:claims.csrf };
  });
  app.post('/api/auth/logout', async (request, reply) => {
    const claims = claimsFromRequest(request); assertCsrf(request, claims);
    const secure=process.env.NODE_ENV==='production'?'; Secure':'';
    reply.header('Set-Cookie',[`arena_staff_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,`arena_student_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`]);
    reply.header('Clear-Site-Data', 'cache');
    return { success: true };
  });
  app.post('/api/auth/password', async (request) => {
    const claims=claimsFromRequest(request);
    if(!['ADMIN','TEACHER','EMPLOYEE'].includes(claims.role))throw Object.assign(new Error('Fitur ini hanya untuk akun personel'),{statusCode:403});
    assertCsrf(request,claims);
    const body=z.object({old_password:z.string().min(1).max(200),new_password:z.string().min(12).max(200)}).strict().parse(request.body);
    const pool=requirePool();
    const[rows]=await pool.execute<RowDataPacket[]>('SELECT password_hash FROM users WHERE id=? AND status=\'ACTIVE\' LIMIT 1',[claims.sub]);
    if(!rows[0])throw Object.assign(new Error('Akun tidak aktif'),{statusCode:404});
    const{compare,hash}=await import('bcryptjs');
    if(!(await compare(body.old_password,String(rows[0].password_hash))))throw Object.assign(new Error('Password lama tidak cocok'),{statusCode:401});
    await pool.execute('UPDATE users SET password_hash=? WHERE id=?',[await hash(body.new_password,12),claims.sub]);
    await audit(pool,claims.sub,claims.role,'PASSWORD_CHANGED','User',claims.sub);
    return{success:true};
  });
}


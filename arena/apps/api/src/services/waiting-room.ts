import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Redis } from 'ioredis';
import { waitingRoomLua } from './waiting-room-lua.js';
import { prewarmExamQuestionSource } from './exam-question-source.js';
import { loadDiagnostics } from '../lib/load-diagnostics.js';

export type WaitingStatus = 'NOT_JOINED' | 'WAITING' | 'ADMITTED' | 'IN_EXAM' | 'FINISHED' | 'ABANDONED' | 'EXPIRED';
export type WaitingClaimReceipt = { tokenHash: string; sequence: number | null };
export type WaitingSettings = { queue_open: number; batch_size: number; batch_interval_ms: number; heartbeat_timeout_ms: number; claim_timeout_ms: number };
export type WaitingView = WaitingSettings & {
  status: WaitingStatus; queue_state: 'OPEN'|'CLOSED'|'NOT_OPEN'|'ENDED'|'DISABLED'; queue_number: number|null;
  position: number|null; ahead: number|null; joined_at_ms: number|null; admit_token: string|null;
  claim_deadline_ms: number|null; waiting_count: number; admitted_count: number; in_exam_count: number; finished_count: number;
  next_batch_at_ms: number; batch_id: number; server_time_ms: number; version: number; estimated_wait_seconds?: number;
  stream_ticket?: string; changed?: boolean; released?: string[];
};
export const WAITING_REGISTRY = 'arena:waiting:active';
export const WAITING_CHANNEL = 'arena:waiting:events';
export const waitingBase = (examId: number) => `arena:waiting:{${examId}}`;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const fail = (code: string, message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode, code });
const errors: Record<string, [string, number]> = {
  QUEUE_NOT_READY: ['Ruang tunggu belum siap. Silakan coba kembali.',503],
  QUEUE_NOT_OPEN: ['Ujian belum dibuka.',409], QUEUE_ENDED: ['Pendaftaran ujian sudah berakhir.',409],
  QUEUE_DISABLED: ['Ujian tidak aktif.',409], QUEUE_CLOSED: ['Antrean sedang ditutup oleh petugas.',409],
  ADMIT_TOKEN_INVALID: ['Token masuk ujian tidak valid. Kembali ke ruang tunggu.',403],
  ADMIT_REQUIRED: ['Anda belum mendapat giliran masuk ujian.',425], CLAIM_BUSY: ['Proses masuk ujian sedang berjalan. Silakan tunggu.',425],
};

export class WaitingRoomService {
  readonly defaults: WaitingSettings;
  private readonly secret: string;
  constructor(readonly redis: Redis | null, private readonly pool: Pool | null, options: Partial<WaitingSettings> & { secret?: string } = {}) {
    this.defaults = {
      queue_open: options.queue_open ?? 1,
      batch_size: options.batch_size ?? Number(process.env.WAITING_BATCH_SIZE ?? 300),
      batch_interval_ms: options.batch_interval_ms ?? Number(process.env.WAITING_BATCH_INTERVAL_MS ?? 10000),
      heartbeat_timeout_ms: options.heartbeat_timeout_ms ?? Number(process.env.WAITING_HEARTBEAT_TIMEOUT_MS ?? 90000),
      claim_timeout_ms: options.claim_timeout_ms ?? Number(process.env.WAITING_CLAIM_TIMEOUT_MS ?? 60000),
    };
    if (redis && typeof redis.defineCommand === 'function') redis.defineCommand('arenaWaitingTransition', { numberOfKeys: 6, lua: waitingRoomLua });
    this.secret = options.secret ?? (process.env.AUTH_TOKEN_SECRET || 'local-development-only');
    if (!Object.values(this.defaults).every(Number.isSafeInteger) || ![0,1].includes(this.defaults.queue_open) || this.defaults.batch_size<1 || this.defaults.batch_size>1000 || this.defaults.batch_interval_ms<1000 || this.defaults.batch_interval_ms>3600000 || this.defaults.heartbeat_timeout_ms<1000 || this.defaults.heartbeat_timeout_ms>600000 || this.defaults.claim_timeout_ms<1000 || this.defaults.claim_timeout_ms>600000) throw new Error('Konfigurasi waiting room tidak valid');
  }

  private db() { if (!this.pool) throw fail('DB_UNAVAILABLE','Database belum dikonfigurasi.',503); return this.pool; }

  async configure(examId: number, supplied?: RowDataPacket, notify = true) {
    let exam = supplied;
    if (!exam) {
      const [rows] = await this.db().execute<RowDataPacket[]>(`SELECT e.*,w.queue_open,w.batch_size,w.batch_interval_ms,w.heartbeat_timeout_ms,w.claim_timeout_ms
        FROM exams e LEFT JOIN exam_waiting_settings w ON w.exam_id=e.id WHERE e.id=?`,[examId]);
      exam = rows[0];
    }
    if (!exam) {
      await this.redis?.srem(WAITING_REGISTRY,String(examId));
      throw fail('EXAM_NOT_FOUND','Ujian tidak ditemukan.',404);
    }
    const settings = Object.fromEntries(Object.entries(this.defaults).map(([key,value]) => [key,Number(exam![key] ?? value)]));
    if (!this.redis) throw fail('REDIS_UNAVAILABLE','Ruang tunggu belum tersedia.',503);
    await this.redis.sadd(WAITING_REGISTRY,String(examId));
    return this.run(examId,0,'configure', { ...settings, exam_status: exam.status, starts_at_ms:new Date(exam.starts_at).getTime(), ends_at_ms:new Date(exam.ends_at).getTime(), retention_ms:172800000 }, notify);
  }

  async join(examId: number, studentId: number, rejoin=false) {
    const [rows] = await this.db().execute<RowDataPacket[]>(`SELECT e.*,w.queue_open,w.batch_size,w.batch_interval_ms,w.heartbeat_timeout_ms,w.claim_timeout_ms,
      a.id attempt_id,a.status attempt_status
      FROM students s JOIN exams e ON e.grade=s.grade_snapshot
      LEFT JOIN exam_attempts a ON a.student_id=s.id AND a.exam_id=e.id
      LEFT JOIN exam_waiting_settings w ON w.exam_id=e.id
      WHERE s.id=? AND e.id=? AND s.is_active=1 AND s.cbt_status='ACTIVE'
      AND (NOT EXISTS(SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id=e.id AND tc.portal_class_id=s.portal_class_id))
      AND (NOT EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id AND ts.student_id=s.id))`,[studentId,examId]);
    const exam=rows[0];
    if (!exam) throw fail('EXAM_FORBIDDEN','Ujian tidak tersedia untuk siswa ini.',403);
    if (exam.attempt_id) return this.resume(examId,studentId);
    await this.configure(examId,exam,false);
    await this.redis!.sadd(`arena:waiting:student:${studentId}`,String(examId));
    await this.redis!.expire(`arena:waiting:student:${studentId}`,172800);
    return this.run(examId,studentId,'join',{rejoin});
  }

  async status(examId:number,studentId:number) { return this.run(examId,studentId,'status'); }
  async heartbeat(examId:number,studentId:number) { return this.run(examId,studentId,'heartbeat'); }
  async leave(examId:number,studentId:number) { return this.run(examId,studentId,'leave'); }
  async summary(examId:number) { await this.configure(examId,undefined,false); return this.status(examId,0); }
  async release(examId:number,manual=false,expectedBatch?:number) {
    // Pre-warm sumber soal sebelum batch siswa di-admit: 300 siswa yang masuk
    // bersamaan tidak boleh jatuh ke query soal MySQL pada saat bersamaan.
    // Fire-and-forget; kegagalan pre-warm tidak memengaruhi release dan lazy
    // loader tetap membaca MySQL (revision authoritative dari migrasi 015).
    if (this.pool) void prewarmExamQuestionSource(this.pool, examId).catch(() => { /* lazy loader menutup */ });
    return this.run(examId,0,'release',{seed:randomBytes(32).toString('hex'),manual,expected_batch:expectedBatch});
  }
  async sweep(examId:number) { return this.run(examId,0,'sweep'); }

  async logout(studentId:number) {
    if (!this.redis) return;
    const exams=await this.redis.smembers(`arena:waiting:student:${studentId}`);
    await Promise.all(exams.map(id=>this.leave(Number(id),studentId)));
  }

  async updateSettings(examId:number,settings:WaitingSettings) {
    await this.db().execute(`INSERT INTO exam_waiting_settings(exam_id,queue_open,batch_size,batch_interval_ms,heartbeat_timeout_ms,claim_timeout_ms) VALUES(?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE queue_open=VALUES(queue_open),batch_size=VALUES(batch_size),batch_interval_ms=VALUES(batch_interval_ms),heartbeat_timeout_ms=VALUES(heartbeat_timeout_ms),claim_timeout_ms=VALUES(claim_timeout_ms)`,
      [examId,settings.queue_open,settings.batch_size,settings.batch_interval_ms,settings.heartbeat_timeout_ms,settings.claim_timeout_ms]);
    return this.summary(examId);
  }

  // Claim lease prevents a cleanup worker expiring an in-flight start. The DB
  // receipt commits with the attempt; retry after a crash keeps the original timer.
  async claim<T>(examId:number,studentId:number,token:string,start:(receipt:WaitingClaimReceipt)=>Promise<T>) {
    if (!/^[a-f0-9]{40,64}$/.test(token)) throw fail('ADMIT_TOKEN_INVALID','Token masuk diperlukan.',403);
    const owner=randomBytes(16).toString('hex');
    let state:WaitingView;
    const [receipts]=await this.db().execute<RowDataPacket[]>('SELECT token_hash,queue_sequence FROM exam_waiting_claims WHERE exam_id=? AND student_id=?',[examId,studentId]);
    const receipt=receipts[0];
    if (receipt && receipt.token_hash===tokenHash(token)) {
      // DB is authoritative if a process died after COMMIT but before Redis ack.
      state={queue_number:receipt.queue_sequence} as WaitingView;
    } else state=await this.run(examId,studentId,'claim_begin',{token,owner});
    try {
      const result=await start({tokenHash:tokenHash(token),sequence:state.queue_number});
      const attempt=result as {attempt_id:string};
      await this.run(examId,studentId,'restore',{status:'IN_EXAM',token,attempt_id:attempt.attempt_id});
      return result;
    } catch(error) {
      try { await this.run(examId,studentId,'claim_abort',{owner}); } catch { /* durable receipt permits recovery */ }
      throw error;
    }
  }

  async resume(examId:number,studentId:number) {
    const [rows]=await this.db().execute<RowDataPacket[]>(`SELECT a.id,a.public_id,a.status,a.expires_at,c.token_hash
      FROM exam_attempts a JOIN students s ON s.id=a.student_id LEFT JOIN exam_waiting_claims c ON c.attempt_id=a.id
      WHERE a.exam_id=? AND a.student_id=? AND s.is_active=1 AND s.cbt_status='ACTIVE'`,[examId,studentId]);
    const attempt=rows[0];
    if (!attempt) throw fail('ATTEMPT_NOT_FOUND','Sesi ujian tidak ditemukan.',404);
    await this.configure(examId,undefined,false);
    const current=await this.status(examId,studentId);
    const state=attempt.status==='IN_PROGRESS' ? 'IN_EXAM' : 'FINISHED';
    if (current.admit_token && attempt.token_hash===tokenHash(current.admit_token)) {
      if (current.status===state) return current;
      return this.run(examId,studentId,'restore',{status:state,token:current.admit_token,attempt_id:attempt.public_id});
    }
    // Deterministic recovery credential avoids token-rotation races on two devices.
    const token=createHmac('sha256',this.secret).update(`waiting-resume:${examId}:${studentId}:${attempt.public_id}`).digest('hex');
    await this.db().execute(`INSERT INTO exam_waiting_claims(exam_id,student_id,attempt_id,token_hash,state) VALUES(?,?,?,?,?)
      ON DUPLICATE KEY UPDATE token_hash=VALUES(token_hash),state=VALUES(state)`,[examId,studentId,attempt.id,tokenHash(token),state]);
    return this.run(examId,studentId,'restore',{status:state,token,attempt_id:attempt.public_id});
  }

  async authorize(examId:number,studentId:number,token:string,finished=false) {
    if (!/^[a-f0-9]{40,64}$/.test(token)) throw fail('ADMIT_TOKEN_INVALID','Token akses ujian diperlukan.',403);
    try { return await this.run(examId,studentId,'guard',{token,finished}); }
    catch(error) {
      // Resolve a missing/stale Redis state against the durable claim only.
      if (!['ADMIT_TOKEN_INVALID','ADMIT_REQUIRED','QUEUE_NOT_READY','REDIS_UNAVAILABLE'].includes((error as {code:string}).code)) throw error;
      const [rows]=await this.db().execute<RowDataPacket[]>(`SELECT c.token_hash,a.status FROM exam_waiting_claims c JOIN exam_attempts a ON a.id=c.attempt_id WHERE c.exam_id=? AND c.student_id=?`,[examId,studentId]);
      const row=rows[0];
      if (!row || row.token_hash!==tokenHash(token) || (!finished && row.status!=='IN_PROGRESS')) throw fail('ADMIT_REQUIRED','Sesi masuk ujian tidak aktif.',403);
      return {status:row.status==='IN_PROGRESS'?'IN_EXAM':'FINISHED'};
    }
  }

  async finish(examId:number,studentId:number) {
    await this.db().execute("UPDATE exam_waiting_claims SET state='FINISHED' WHERE exam_id=? AND student_id=?",[examId,studentId]);
    await this.run(examId,studentId,'finish');
  }

  async reconcile(examId:number) {
    let after=0;
    while (true) {
      const [rows]=await this.db().execute<RowDataPacket[]>(`SELECT c.student_id,c.token_hash,c.state,a.public_id,a.status FROM exam_waiting_claims c
        JOIN exam_attempts a ON a.id=c.attempt_id WHERE c.exam_id=? AND c.student_id>? ORDER BY c.student_id LIMIT 500`,[examId,after]);
      if (!rows.length) break;
      for (const row of rows) {
        after=Number(row.student_id);
        const current=await this.status(examId,after);
        const desired=row.status==='IN_PROGRESS'?'IN_EXAM':'FINISHED';
        if (current.status==='FINISHED' && desired==='IN_EXAM') continue; // admin recovery is explicit via resume
        if (current.status===desired && current.admit_token && tokenHash(current.admit_token)===row.token_hash) continue;
        let token=current.admit_token;
        if (!token || tokenHash(token)!==row.token_hash) {
          token=createHmac('sha256',this.secret).update(`waiting-resume:${examId}:${after}:${row.public_id}`).digest('hex');
          const [updated]=await this.db().execute('UPDATE exam_waiting_claims SET token_hash=?,state=? WHERE exam_id=? AND student_id=? AND token_hash=?',[tokenHash(token),desired,examId,after,row.token_hash]);
          if (!(updated as {affectedRows:number}).affectedRows) continue;
        } else if (row.state!==desired) await this.db().execute('UPDATE exam_waiting_claims SET state=? WHERE exam_id=? AND student_id=?',[desired,examId,after]);
        await this.run(examId,after,'restore',{status:desired,token,attempt_id:row.public_id});
      }
      if (rows.length<500) break;
    }
  }

  streamTicket(examId:number,studentId:number,authExpiry:number) {
    const payload=Buffer.from(JSON.stringify({examId,studentId,exp:Math.min(authExpiry,Math.floor(Date.now()/1000)+900)})).toString('base64url');
    return `${payload}.${createHmac('sha256',this.secret).update(payload).digest('base64url')}`;
  }
  verifyStreamTicket(value:string,examId:number,studentId:number) {
    const [payload,signature,...extra]=value.split('.');
    if (!payload || !signature || extra.length) throw fail('STREAM_TOKEN_INVALID','Tiket koneksi tidak valid.',403);
    const expected=createHmac('sha256',this.secret).update(payload).digest();
    const actual=Buffer.from(signature,'base64url');
    if (expected.length!==actual.length || !timingSafeEqual(expected,actual)) throw fail('STREAM_TOKEN_INVALID','Tiket koneksi tidak valid.',403);
    let decoded:{examId:number;studentId:number;exp:number};
    try { decoded=JSON.parse(Buffer.from(payload,'base64url').toString()); } catch { throw fail('STREAM_TOKEN_INVALID','Tiket koneksi tidak valid.',403); }
    if (decoded.examId!==examId || decoded.studentId!==studentId || !Number.isInteger(decoded.exp) || decoded.exp<=Date.now()/1000) throw fail('STREAM_TOKEN_INVALID','Tiket koneksi sudah berakhir.',403);
  }
  publicView(view:WaitingView,examId:number,studentId:number,authExpiry:number) {
    const {changed,released,...result}=view;
    return {...result,released_count:released?.length ?? 0,stream_ticket:this.streamTicket(examId,studentId,authExpiry)};
  }

  private transition(args: string[]) {
    const client = this.redis as Redis & { arenaWaitingTransition?: (...args: string[]) => Promise<string> };
    // ioredis caches the Lua SHA and retries EVAL after NOSCRIPT (e.g. Redis restart).
    // Keep eval fallback for lightweight test doubles.
    return client.arenaWaitingTransition ? client.arenaWaitingTransition(...args) : client.eval(waitingRoomLua, 6, ...args);
  }

  private async run(examId:number,studentId:number,op:string,data:Record<string,unknown>={},notify=true) {
    if (!this.redis || this.redis.status!=='ready') throw fail('REDIS_UNAVAILABLE','Ruang tunggu belum tersedia. Sistem akan mencoba kembali.',503);
    const started=performance.now();
    const base=waitingBase(examId);
    let parsed:WaitingView & {error?:string};
    try { parsed=JSON.parse(await this.transition([`${base}:meta`,`${base}:waiting`,`${base}:heartbeats`,`${base}:admitted`,`${base}:sequence`,`${base}:counts`,op,String(studentId),JSON.stringify(data),base]) as string); }
    catch(cause) {
      loadDiagnostics.record('waiting_transition',{op,outcome:'redis_error',total_ms:Number((performance.now()-started).toFixed(2))});
      throw Object.assign(fail('REDIS_UNAVAILABLE','Ruang tunggu belum tersedia.',503),{cause:new Error(cause instanceof Error?cause.message:'Redis command failed')});
    }
    if (parsed.error) {
      loadDiagnostics.record('waiting_transition',{op,outcome:parsed.error,total_ms:Number((performance.now()-started).toFixed(2))});
      const [message,status]=errors[parsed.error] ?? ['Transisi ruang tunggu tidak valid.',409]; throw fail(parsed.error,message,status);
    }
    if (!Array.isArray(parsed.released)) parsed.released=[];
    loadDiagnostics.record('waiting_transition',{op,outcome:'ok',changed:parsed.changed?1:0,released:parsed.released.length,total_ms:Number((performance.now()-started).toFixed(2))});
    // Notifications are hints: a lost publish must not turn a committed transition
    // into a failed request. Polling and SSE keepalives read the authoritative state.
    // Tahap 3: sertakan siswa yang berubah supaya SSE tidak membaca ulang seluruh
    // exam saat satu siswa join/release. `null` berarti semua klien exam ini.
    if (parsed.changed && notify) {
      const students = parsed.released.length ? parsed.released.map(Number) : studentId > 0 ? [studentId] : null;
      await this.redis.publish(WAITING_CHANNEL,JSON.stringify({examId,version:parsed.version,students})).catch(()=>{});
    }
    return parsed;
  }
}

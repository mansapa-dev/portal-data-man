import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePool } from '../lib/db.js';
import { assertCsrf, claimsFromRequest, issueToken, newCsrf } from '../lib/auth.js';
import type { RowDataPacket } from 'mysql2/promise';

const loginSchema = z.object({ nisn: z.string().trim().min(8).max(20), pin: z.string().trim().min(4).max(12) }).strict();
function normalizeDigits(value: string) { return value.replace(/[\s\u00a0\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu, '').replace(/[０-９٠-٩۰-۹]/gu, (digit) => String.fromCharCode((digit.codePointAt(0)! >= 0xff10 && digit.codePointAt(0)! <= 0xff19) ? digit.codePointAt(0)! - 0xff10 + 48 : digit.codePointAt(0)! >= 0x660 && digit.codePointAt(0)! <= 0x669 ? digit.codePointAt(0)! - 0x660 + 48 : digit.codePointAt(0)! - 0x6f0 + 48)); }

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/student/login', {
    config: { rateLimit: { max: 12, timeWindow: '10 minutes', keyGenerator: (request) => { const body=request.body as {nisn?:string}|undefined;return `student-login:${String(body?.nisn??'').replace(/\D/g,'').slice(0,20)}`; } } },
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const nisn = normalizeDigits(body.nisn); const pin = normalizeDigits(body.pin);
    if (!/^\d{8,20}$/.test(nisn) || !/^\d{4,12}$/.test(pin)) throw Object.assign(new Error('NISN atau PIN tidak valid'), { statusCode: 422 });
    const pool = requirePool();
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT id,nisn,name_snapshot,class_snapshot,grade_snapshot,pin_hash,cbt_status FROM students WHERE nisn=? AND is_active=1 LIMIT 1', [nisn]);
    const student = rows[0];
    const valid = student?.cbt_status === 'ACTIVE' && typeof student.pin_hash === 'string' && await BunPassword.verify(pin, student.pin_hash);
    if (!valid) throw Object.assign(new Error('NISN atau PIN salah'), { statusCode: 401 });
    const csrf = newCsrf();
    const token = issueToken({ sub: Number(student.id), role: 'STUDENT', exp: Math.floor(Date.now() / 1000) + 3600, csrf });
    reply.header('Cache-Control', 'no-store');
    return { token, csrf_token: csrf, expires_in: 3600, student: { id: Number(student.id), nisn: student.nisn, nama: student.name_snapshot, kelas: student.class_snapshot, tingkat: student.grade_snapshot } };
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
    return { staff:{id:Number(staff.id),username:staff.username,nama:staff.name,role:staff.role},csrf_token:claims.csrf };
  });
  app.post('/api/auth/logout', async (request, reply) => {
    const claims = claimsFromRequest(request); assertCsrf(request, claims);
    reply.header('Clear-Site-Data', 'cache');
    return { success: true };
  });
}

const BunPassword = {
  async verify(pin: string, encoded: string) {
    // bcrypt hashes use bcryptjs; PHP PASSWORD_DEFAULT hashes use bcrypt on supported legacy records.
    const { compare } = await import('bcryptjs');
    return compare(pin, encoded);
  },
};

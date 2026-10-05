import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { newCsrf, issueToken } from '../lib/auth.js';
import { requirePool } from '../lib/db.js';

const schema = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) }).strict();
export async function staffAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/staff/login', {
    config: { rateLimit: { max: 8, timeWindow: '10 minutes', keyGenerator: (request) => `staff-login:${String((request.body as {username?:string}|undefined)?.username??'').trim().toLowerCase().slice(0,100)}` } },
  }, async (request, reply) => {
    const body = schema.parse(request.body);
    const [rows] = await requirePool().execute<RowDataPacket[]>(`SELECT u.id,u.username,u.password_hash,u.name,u.role,u.status,u.teacher_id,u.employee_id,t.nip teacher_nip,e.nip employee_nip
      FROM users u LEFT JOIN teachers t ON t.id=u.teacher_id LEFT JOIN employees e ON e.id=u.employee_id WHERE u.username=? LIMIT 1`, [body.username]);
    const user = rows[0];
    const { compare } = await import('bcryptjs');
    if (!user || user.status !== 'ACTIVE' || !(await compare(body.password, user.password_hash))) throw Object.assign(new Error('Username atau password salah'), { statusCode: 401 });
    const csrf = newCsrf();
    const token = issueToken({ sub: Number(user.id), role: user.role, exp: Math.floor(Date.now() / 1000) + 7200, csrf });
    reply.header('Cache-Control', 'no-store');
    return { token, csrf_token: csrf, expires_in: 7200, staff: { id: Number(user.id), nama: user.name, username: user.username, role: user.role, nip: user.teacher_nip ?? user.employee_nip ?? null } };
  });
}

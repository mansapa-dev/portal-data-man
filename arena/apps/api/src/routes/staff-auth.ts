import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { newCsrf, issueToken } from '../lib/auth.js';
import { requirePool } from '../lib/db.js';
import { staffCapabilities } from '../services/staff-capabilities.js';

const schema = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) }).strict();
const staffSessionSeconds=7*24*60*60;
function setStaffCookie(reply:import('fastify').FastifyReply,token:string){reply.header('Set-Cookie',`arena_staff_session=${token}; Path=/; Max-Age=${staffSessionSeconds}; HttpOnly; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`);}
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
    const token = issueToken({ sub: Number(user.id), role: user.role, exp: Math.floor(Date.now() / 1000) + staffSessionSeconds, csrf });
    setStaffCookie(reply,token);
    reply.header('Cache-Control', 'no-store');
    return { csrf_token: csrf, expires_in: staffSessionSeconds, staff: { id: Number(user.id), nama: user.name, username: user.username, role: user.role, nip: user.teacher_nip ?? user.employee_nip ?? null, capabilities: await staffCapabilities(requirePool(), Number(user.id), user.role) } };
  });
  app.get('/api/auth/staff/session',async(request,reply)=>{
    const part=request.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith('arena_staff_session='));
    const token=part?.slice('arena_staff_session='.length);
    if(!token)throw Object.assign(new Error('Login diperlukan'),{statusCode:401});
    const{readToken}=await import('../lib/auth.js');const claims=readToken(token);
    if(!claims||!['ADMIN','TEACHER','EMPLOYEE'].includes(claims.role))throw Object.assign(new Error('Sesi tidak valid atau sudah berakhir'),{statusCode:401});
    const[rows]=await requirePool().execute<RowDataPacket[]>('SELECT id,username,name,role,status FROM users WHERE id=? LIMIT 1',[claims.sub]);const user=rows[0];
    if(!user||user.status!=='ACTIVE'||user.role!==claims.role)throw Object.assign(new Error('Akun personel tidak aktif'),{statusCode:401});
    const csrf=claims.csrf;const refreshed=issueToken({sub:Number(user.id),role:user.role,exp:Math.floor(Date.now()/1000)+staffSessionSeconds,csrf});setStaffCookie(reply,refreshed);reply.header('Cache-Control','no-store');
    return{csrf_token:csrf,expires_in:staffSessionSeconds,staff:{id:Number(user.id),username:user.username,nama:user.name,role:user.role,capabilities:await staffCapabilities(requirePool(),Number(user.id),user.role)}};
  });
}

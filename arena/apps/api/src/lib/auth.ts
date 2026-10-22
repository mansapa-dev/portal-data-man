import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

const secret = process.env.AUTH_TOKEN_SECRET ?? '';
if (process.env.NODE_ENV === 'production' && secret.length < 32) throw new Error('AUTH_TOKEN_SECRET must contain at least 32 characters in production');
const signingKey = secret || 'local-development-only';
export type Claims = { sub: number; role: 'STUDENT' | 'ADMIN' | 'TEACHER' | 'EMPLOYEE'; exp: number; csrf: string };
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function issueToken(claims: Claims): string {
  const payload = encode(claims);
  const signature = createHmac('sha256', signingKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function readToken(token: string): Claims | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', signingKey).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Claims;
    if (!Number.isSafeInteger(claims.sub) || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}

export function rateLimitKey(request: Pick<FastifyRequest, 'headers' | 'ip'>): string {
  const bearer = request.headers.authorization?.startsWith('Bearer ')
    ? request.headers.authorization.slice(7)
    : '';
  const cookies = request.headers.cookie?.split(';').map((part) => part.trim()) ?? [];
  const staffCookie = cookies.find((part) => part.startsWith('arena_staff_session='))?.slice('arena_staff_session='.length) ?? '';
  const studentCookie = cookies.find((part) => part.startsWith('arena_student_session='))?.slice('arena_student_session='.length) ?? '';
  const claims = [bearer, staffCookie, studentCookie].map(readToken).find((value): value is Claims => value !== null);
  return claims ? `${claims.role}:${claims.sub}` : `ip:${request.ip}`;
}

export function normalizeStudentDigits(value: string): string {
  return value
    .replace(/[\s\u00a0\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu, '')
    .replace(/[０-９٠-٩۰-۹]/gu, (digit) => {
      const codePoint = digit.codePointAt(0)!;
      return String.fromCharCode(codePoint >= 0xff10 && codePoint <= 0xff19 ? codePoint - 0xff10 + 48 : codePoint >= 0x660 && codePoint <= 0x669 ? codePoint - 0x660 + 48 : codePoint - 0x6f0 + 48);
    });
}

export function studentLoginRateLimitKey(value: unknown): string {
  const nisn = typeof value === 'object' && value !== null && 'nisn' in value ? (value as { nisn?: unknown }).nisn : '';
  return `student-login:${normalizeStudentDigits(String(nisn ?? '')).slice(0, 20)}`;
}

export function claimsFromRequest(request: FastifyRequest): Claims {
  const header = request.headers.authorization;
  const cookies=request.headers.cookie?.split(';').map((part)=>part.trim())??[];
  const staffCookie=cookies.find((part)=>part.startsWith('arena_staff_session='))?.slice('arena_staff_session='.length);
  const studentCookie=cookies.find((part)=>part.startsWith('arena_student_session='))?.slice('arena_student_session='.length);
  let token=header?.startsWith('Bearer ')?header.slice(7):undefined;
  if(!token){
    const path=request.url.split('?')[0]??request.url;
    const csrfHeader=request.headers['x-csrf-token'];
    const studentRoute=path.startsWith('/api/student/')||path.startsWith('/api/auth/student/');
    const staffRoute=path.startsWith('/api/admin/')||path.startsWith('/api/staff/')||path.startsWith('/api/teacher/')||path.startsWith('/api/auth/staff/');
    if(studentRoute)token=studentCookie;
    else if(staffRoute)token=staffCookie;
    else if(typeof csrfHeader==='string')token=[staffCookie,studentCookie].find((candidate)=>candidate&&readToken(candidate)?.csrf===csrfHeader);
    else token=staffCookie??studentCookie;
  }
  if (!token) throw Object.assign(new Error('Login diperlukan'), { statusCode: 401 });
  const claims = readToken(token);
  if (!claims) throw Object.assign(new Error('Sesi tidak valid atau sudah berakhir'), { statusCode: 401 });
  return claims;
}

export function assertCsrf(request: FastifyRequest, claims: Claims, options: { allowBodyToken?: boolean } = {}) {
  const header = request.headers['x-csrf-token'];
  if (typeof header === 'string' && header === claims.csrf) return;
  // navigator.sendBeacon cannot set custom headers, so a narrow allowlist of
  // beacon endpoints may submit the CSRF token inside the JSON body instead.
  if (options.allowBodyToken && typeof request.body === 'object' && request.body !== null) {
    const bodyToken = (request.body as { csrf_token?: unknown }).csrf_token;
    if (typeof bodyToken === 'string' && bodyToken === claims.csrf) return;
  }
  throw Object.assign(new Error('Token CSRF tidak valid'), { statusCode: 403 });
}

export const newCsrf = () => randomBytes(32).toString('hex');

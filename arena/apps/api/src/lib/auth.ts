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

export function claimsFromRequest(request: FastifyRequest): Claims {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw Object.assign(new Error('Login diperlukan'), { statusCode: 401 });
  const claims = readToken(header.slice(7));
  if (!claims) throw Object.assign(new Error('Sesi tidak valid atau sudah berakhir'), { statusCode: 401 });
  return claims;
}

export function assertCsrf(request: FastifyRequest, claims: Claims) {
  const csrf = request.headers['x-csrf-token'];
  if (typeof csrf !== 'string' || csrf !== claims.csrf) throw Object.assign(new Error('Token CSRF tidak valid'), { statusCode: 403 });
}

export const newCsrf = () => randomBytes(32).toString('hex');

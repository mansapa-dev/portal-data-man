import type { FastifyRequest } from 'fastify';
import { claimsFromRequest, assertCsrf } from './auth.js';
export function requireRole(request: FastifyRequest, roles: readonly string[], mutate = false) {
  const claims = claimsFromRequest(request);
  if (!roles.includes(claims.role)) throw Object.assign(new Error('Akses ditolak'), { statusCode: 403 });
  if (mutate) assertCsrf(request, claims);
  return claims;
}

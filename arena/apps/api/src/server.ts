import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { pool } from './lib/db.js';
import { authRoutes } from './routes/auth.js';
import { studentExamRoutes } from './routes/student-exams.js';
import { staffAuthRoutes } from './routes/staff-auth.js';
import { adminRoutes } from './routes/admin.js';
import { supportRoutes } from './routes/support.js';
import { ssoRoutes } from './routes/sso.js';
import { portalSyncRoutes } from './routes/portal-sync.js';
import { readToken } from './lib/auth.js';
import { setupRoutes } from './routes/setup.js';
import { staffRoutes } from './routes/staff.js';

const env = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  REDIS_URL: z.string().url().optional(),
}).parse(process.env);

const app = Fastify({
  logger: { level: env.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.pin', 'req.body.password'] },
  trustProxy: env.TRUST_PROXY === 'true',
  bodyLimit: 64 * 1024,
  requestTimeout: 15_000,
  keepAliveTimeout: 5_000,
  maxRequestsPerSocket: 1_000,
});
await app.register(helmet);
await app.register(sensible);
const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false }) : null;
await app.register(rateLimit, redis
  ? { hook: 'preHandler', max: 180, timeWindow: '1 minute', redis, keyGenerator: (request) => { const bearer=request.headers.authorization?.startsWith('Bearer ')?request.headers.authorization.slice(7):'';const claims=bearer?readToken(bearer):null;return claims?`${claims.role}:${claims.sub}`:`ip:${request.ip}`; } }
  : { hook: 'preHandler', max: 180, timeWindow: '1 minute', keyGenerator: (request) => { const bearer=request.headers.authorization?.startsWith('Bearer ')?request.headers.authorization.slice(7):'';const claims=bearer?readToken(bearer):null;return claims?`${claims.role}:${claims.sub}`:`ip:${request.ip}`; } });

app.get('/health/live', async () => ({ status: 'ok' }));
app.get('/health/ready', async (_request, reply) => {
  if (!pool) return reply.serviceUnavailable('Database is not configured');
  try {
    await pool.query('SELECT 1');
    if (redis && redis.status !== 'ready') return reply.code(503).send({ status: 'degraded', database: 'ok', redis: 'unavailable' });
    return { status: 'ok', database: 'ok', redis: redis ? 'ok' : 'not-configured' };
  } catch {
    return reply.code(503).send({ status: 'degraded', database: 'unavailable' });
  }
});

await app.register(authRoutes);
await app.register(staffAuthRoutes);
await app.register(ssoRoutes);
await app.register(setupRoutes);
if (pool) {
  await app.register(studentExamRoutes);
  await app.register(adminRoutes);
  await app.register(supportRoutes);
  await app.register(portalSyncRoutes);
  await app.register(staffRoutes);
}

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'request failed');
  const candidate = error as Error & { statusCode?: number };
  const status = error instanceof z.ZodError ? 422 : candidate.statusCode && candidate.statusCode >= 400 && candidate.statusCode < 600 ? candidate.statusCode : 500;
  return reply.status(status).send({ error: status >= 500 ? 'Internal server error' : error instanceof z.ZodError ? error.issues.map((issue)=>issue.message).join(', ') : candidate.message });
});

const close = async () => {
  await app.close();
  await pool?.end();
  await redis?.quit();
};
process.once('SIGINT', () => void close().then(() => process.exit(0)));
process.once('SIGTERM', () => void close().then(() => process.exit(0)));
await app.listen({ host: env.HOST, port: env.PORT });

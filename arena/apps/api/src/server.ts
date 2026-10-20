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
import { rateLimitKey } from './lib/auth.js';
import { setupRoutes } from './routes/setup.js';
import { staffRoutes } from './routes/staff.js';
import { questionImageRoutes } from './routes/question-images.js';
import { ScoringService } from './services/scoring.js';
import { ExpiredAttemptFinalizer } from './services/expired-attempt-finalizer.js';
import { closePasswordVerifier, getVerifierStats } from './services/password-verifier.js';
import { ArenaRateLimitStore } from './lib/rate-limit-store.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
eventLoopMonitor.enable();

const env = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  REDIS_URL: z.string().url().optional(),
  ATTEMPT_FINALIZER_ENABLED: z.enum(['true','false']).default('true'),
  ATTEMPT_FINALIZER_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).default(30_000),
  ATTEMPT_FINALIZER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(50),
  ARENA_LOGIN_DIAGNOSTICS: z.enum(['true','false']).default('false'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(45_000),
}).parse(process.env);

const app = Fastify({
  logger: { level: env.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.pin', 'req.body.password'] },
  trustProxy: env.TRUST_PROXY === 'true',
  bodyLimit: 64 * 1024,
  requestTimeout: env.REQUEST_TIMEOUT_MS,
  keepAliveTimeout: 5_000,
  maxRequestsPerSocket: 1_000,
});
await app.register(helmet);
await app.register(sensible);
const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false }) : null;
const finalizer = pool && env.ATTEMPT_FINALIZER_ENABLED === 'true'
  ? new ExpiredAttemptFinalizer(pool, new ScoringService(pool), app.log, env.ATTEMPT_FINALIZER_INTERVAL_MS, env.ATTEMPT_FINALIZER_BATCH_SIZE)
  : null;
// Keep a generous per-session request budget for active students (autosave,
// exam reads and heartbeat), while retaining the lower anonymous/staff budget.
// Authentication routes have their own stricter account-specific limits.
const sessionRateLimit = {
  hook: 'preHandler' as const,
  max: (_request: import('fastify').FastifyRequest, key: string) => key.startsWith('STUDENT:') ? 1_200 : 180,
  timeWindow: '1 minute',
  redis: redis ?? undefined,
  keyGenerator: rateLimitKey,
  store: ArenaRateLimitStore,
};
await app.register(rateLimit, sessionRateLimit);

app.get('/health/live', async () => ({
  status: 'ok',
  eventLoopDelayMs: {
    mean: Number((eventLoopMonitor.mean / 1e6).toFixed(2)),
    p95: Number((eventLoopMonitor.percentile(95) / 1e6).toFixed(2)),
    p99: Number((eventLoopMonitor.percentile(99) / 1e6).toFixed(2)),
    max: Number((eventLoopMonitor.max / 1e6).toFixed(2)),
  },
  verifier: getVerifierStats(),
}));
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
  await app.register(questionImageRoutes);
}

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'request failed');
  const candidate = error as Error & { statusCode?: number };
  const status = error instanceof z.ZodError ? 422 : candidate.statusCode && candidate.statusCode >= 400 && candidate.statusCode < 600 ? candidate.statusCode : 500;
  return reply.status(status).send({ error: status >= 500 ? 'Internal server error' : error instanceof z.ZodError ? error.issues.map((issue)=>issue.message).join(', ') : candidate.message });
});

const close = async () => {
  await finalizer?.stop();
  await app.close();
  await closePasswordVerifier();
  await pool?.end();
  await redis?.quit();
};
process.once('SIGINT', () => void close().then(() => process.exit(0)));
process.once('SIGTERM', () => void close().then(() => process.exit(0)));
await app.listen({ host: env.HOST, port: env.PORT });
finalizer?.start();

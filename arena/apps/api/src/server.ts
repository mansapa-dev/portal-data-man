import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { z } from 'zod';
import { closeAuthPool, pool } from './lib/db.js';
import { authRoutes } from './routes/auth.js';
import { studentExamRoutes } from './routes/student-exams.js';
import { waitingRoomRoutes } from './routes/waiting-room.js';
import { waitingRoom } from './lib/waiting-room.js';
import { WaitingRoomEvents } from './services/waiting-room-events.js';
import { WaitingRoomWorker } from './services/waiting-room-worker.js';
import { staffAuthRoutes } from './routes/staff-auth.js';
import { adminRoutes } from './routes/admin.js';
import { supportRoutes } from './routes/support.js';
import { ssoRoutes } from './routes/sso.js';
import { portalSyncRoutes } from './routes/portal-sync.js';
import { rateLimitKey } from './lib/auth.js';
import { buildAppOptions } from './lib/app-options.js';
import { setupRoutes } from './routes/setup.js';
import { staffRoutes } from './routes/staff.js';
import { questionImageRoutes } from './routes/question-images.js';
import { ScoringService } from './services/scoring.js';
import { ExpiredAttemptFinalizer } from './services/expired-attempt-finalizer.js';
import { closePasswordVerifier, getVerifierStats } from './services/password-verifier.js';
import { sharedRateLimitStore } from './lib/rate-limit-store.js';
import { redis } from './lib/redis.js';
import { loadDiagnostics } from './lib/load-diagnostics.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
eventLoopMonitor.enable();

const env = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('warn'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  REDIS_URL: z.string().url().optional(),
  ATTEMPT_FINALIZER_ENABLED: z.enum(['true','false']).default('true'),
  ATTEMPT_FINALIZER_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).default(30_000),
  ATTEMPT_FINALIZER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(50),
  ARENA_LOGIN_DIAGNOSTICS: z.enum(['true','false']).default('false'),
  ARENA_LOAD_DIAGNOSTICS: z.enum(['true','false']).default('false'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(45_000),
}).parse(process.env);

const app = Fastify(buildAppOptions({ logLevel: env.LOG_LEVEL, trustProxy: env.TRUST_PROXY === 'true', requestTimeoutMs: env.REQUEST_TIMEOUT_MS }));
loadDiagnostics.start(app.log, env.ARENA_LOAD_DIAGNOSTICS === 'true');
await app.register(helmet);
app.addHook('onSend', async (request, reply, payload) => {
  if (/^\/(api|auth|health)(\/|$)/.test(request.url)) {
    reply.header('Cache-Control', 'private, no-store');
    reply.header('CDN-Cache-Control', 'no-store');
    reply.header('Cloudflare-CDN-Cache-Control', 'no-store');
  }
  return payload;
});
await app.register(sensible);
// The error handler MUST be registered before any route plugin: `await app.register(...)`
// boots each plugin immediately, and plugin contexts that finish loading before a
// setErrorHandler call never inherit it. Registering it late made every route error
// (including zod 422 payloads) fall back to Fastify's default handler as HTTP 500.
app.setErrorHandler((error, request, reply) => {
  if ((error as { statusCode?: number }).statusCode !== 425) request.log.error({ err: error }, 'request failed');
  const candidate = error as Error & { statusCode?: number; code?: string };
  const errorCode = typeof candidate.code === 'string' ? candidate.code : '';
  const isDbTransient = /ER_LOCK_WAIT_TIMEOUT|ER_LOCK_DEADLOCK|ETIMEDOUT|ECONNRESET|PROTOCOL_CONNECTION_LOST/.test(errorCode || candidate.message);
  const overloaded = isDbTransient || /Queue limit reached|No connections available/.test(candidate.message);
  const status = overloaded ? 503 : error instanceof z.ZodError ? 422 : candidate.statusCode && candidate.statusCode >= 400 && candidate.statusCode < 600 ? candidate.statusCode : 500;
  const retryAfter = overloaded ? 2 : status === 425 ? 7 : undefined;
  if (retryAfter !== undefined) reply.header('Retry-After', String(retryAfter));
  if (status === 425) reply.header('Retry-After', '7');
  const code = errorCode || (overloaded ? 'TEMPORARY_OVERLOAD' : error instanceof z.ZodError ? 'VALIDATION_ERROR' : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_REJECTED');
  const retryable = status === 408 || status === 425 || status === 429 || status === 502 || status === 503 || status === 504 || isDbTransient;
  reply.header('X-Request-Id', request.id);
  return reply.status(status).send({
    success: false,
    code,
    error: status >= 500 ? 'Internal server error' : error instanceof z.ZodError ? error.issues.map((issue)=>issue.message).join(', ') : candidate.message,
    retryable,
    ...(retryAfter !== undefined ? { retry_after: retryAfter } : {}),
    request_id: request.id,
  });
});
const finalizer = pool && env.ATTEMPT_FINALIZER_ENABLED === 'true'
  ? new ExpiredAttemptFinalizer(pool, new ScoringService(pool), app.log, env.ATTEMPT_FINALIZER_INTERVAL_MS, env.ATTEMPT_FINALIZER_BATCH_SIZE)
  : null;
const waitingEvents=new WaitingRoomEvents(waitingRoom);
const waitingWorker=pool && process.env.WAITING_WORKER_ENABLED!=='false' ? new WaitingRoomWorker(waitingRoom,app.log) : null;
// The custom store receives normalized plugin options; capture the shared Redis
// explicitly because @fastify/rate-limit does not pass settings.redis to it.
// Keep a generous per-session request budget for active students (autosave,
// exam reads and heartbeat), while retaining the lower anonymous/staff budget.
// Authentication routes have their own stricter account-specific limits.
const sessionRateLimit = {
  hook: 'preHandler' as const,
  max: (_request: import('fastify').FastifyRequest, key: string) => key.startsWith('STUDENT:') ? 1_200 : 180,
  timeWindow: '1 minute',
  redis: redis ?? undefined,
  keyGenerator: rateLimitKey,
  store: sharedRateLimitStore(redis),
};
await app.register(rateLimit, sessionRateLimit);

app.get('/health', async () => ({ status: 'ok' }));
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
app.get('/ready', async (_request, reply) => {
  if (!pool) return reply.serviceUnavailable('Database is not configured');
  try {
    await pool.query('SELECT 1');
    if (redis && redis.status !== 'ready') return reply.code(503).send({ status: 'degraded', database: 'ok', redis: 'unavailable' });
    return { status: 'ok', database: 'ok', redis: redis ? 'ok' : 'not-configured' };
  } catch {
    return reply.code(503).send({ status: 'degraded', database: 'unavailable' });
  }
});
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
  await app.register(waitingRoomRoutes,{events:waitingEvents});
  await app.register(adminRoutes);
  await app.register(supportRoutes);
  await app.register(portalSyncRoutes);
  await app.register(staffRoutes);
  await app.register(questionImageRoutes);
}

const close = async () => {
  await waitingWorker?.stop();
  await waitingEvents.stop();
  await finalizer?.stop();
  loadDiagnostics.stop();
  await app.close();
  await closePasswordVerifier();
  await pool?.end();
  await closeAuthPool();
  await redis?.quit();
};
process.once('SIGINT', () => void close().then(() => process.exit(0)));
process.once('SIGTERM', () => void close().then(() => process.exit(0)));
await app.listen({ host: env.HOST, port: env.PORT });
if(pool)waitingEvents.start();
waitingWorker?.start();
finalizer?.start();

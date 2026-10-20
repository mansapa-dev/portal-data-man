/**
 * queue-overload-resilience.test.mjs
 *
 * Verifies that:
 * 1. 503 responses from queue overload / busy state do NOT count as failed credential attempts
 *    in the rate limiter (students are not penalized with 429 when the server is overloaded).
 * 2. Real credential failures (401) DO count towards the rate limit and eventually trigger 429.
 * 3. 503 responses carry the Retry-After header.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { ArenaRateLimitStore, refundStudentLoginRateLimit } from '../dist/lib/rate-limit-store.js';
import { studentLoginRateLimitKey } from '../dist/lib/auth.js';

test('503 dari server overload tidak menghabiskan kuota rate limit siswa', async () => {
  const app = Fastify();
  await app.register(rateLimit, { global: false, hook: 'preHandler', store: ArenaRateLimitStore });

  const nisn = '1234567890';
  const rateLimitConfig = {
    max: 3, // Very tight limit to test quickly
    timeWindow: '10 minutes',
    keyGenerator: (request) => studentLoginRateLimitKey(request.body),
  };

  let simulatedOutcome = '503';

  app.post('/api/auth/student/login', {
    config: { rateLimit: rateLimitConfig },
  }, async (request, reply) => {
    const key = studentLoginRateLimitKey(request.body);
    if (simulatedOutcome === '503') {
      refundStudentLoginRateLimit(key);
      reply.header('Retry-After', '2');
      return reply.code(503).send({ error: 'Layanan login sedang sibuk. Coba lagi sebentar.' });
    }
    if (simulatedOutcome === '401') {
      return reply.code(401).send({ error: 'NISN atau PIN salah' });
    }
    return { token: 'mock-token' };
  });

  try {
    // 1. Send 10 consecutive requests while the server responds with 503 (overload)
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/student/login',
        payload: { nisn, pin: '1234' },
      });
      assert.equal(res.statusCode, 503, `Request ${i + 1} harus 503`);
      assert.equal(res.headers['retry-after'], '2', 'Harus menyertakan header Retry-After');
    }

    // 2. Now simulate normal login - since 503s were refunded, the student should NOT be locked out with 429
    simulatedOutcome = '200';
    const successRes = await app.inject({
      method: 'POST',
      url: '/api/auth/student/login',
      payload: { nisn, pin: '1234' },
    });
    assert.equal(successRes.statusCode, 200, 'Login harus sukses setelah serangkaian 503 tanpa terblokir 429');

    // 3. Now simulate credential failures (401) - these MUST count against the limit
    simulatedOutcome = '401';
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/student/login',
        payload: { nisn, pin: '0000' },
      });
      // First 2 fail with 401, 3rd exceeds max=3 (since 200 counted 1 + 2 x 401 = 3)
      if (i < 2) {
        assert.equal(res.statusCode, 401, `Failed attempt ${i + 1} harus 401`);
      } else {
        assert.equal(res.statusCode, 429, 'Attempt ke-4 harus diblokir dengan 429 Too Many Requests');
      }
    }
  } finally {
    await app.close();
  }
});

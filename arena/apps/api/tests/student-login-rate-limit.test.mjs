import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { studentLoginRateLimit } from '../dist/routes/auth.js';

test('limiter login tetap membatasi per NISN tanpa menggabungkan siswa satu sekolah', async () => {
  const app = Fastify();
  // Match Arena's server hook: preHandler runs after request body parsing.
  await app.register(rateLimit, { global: false, hook: 'preHandler' });
  app.post('/login', { config: { rateLimit: studentLoginRateLimit } }, async () => ({ ok: true }));
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await app.inject({ method: 'POST', url: '/login', payload: { nisn: '1234567890', pin: '0000' } });
      assert.equal(response.statusCode, 200);
    }
    const blocked = await app.inject({ method: 'POST', url: '/login', headers: { cookie: 'arena_student_session=changed-cookie' }, payload: { nisn: '1234567890', pin: '0000' } });
    assert.equal(blocked.statusCode, 429);

    const anotherStudent = await app.inject({ method: 'POST', url: '/login', payload: { nisn: '1234567891', pin: '0000' } });
    assert.equal(anotherStudent.statusCode, 200);
    const normalizedSameStudent = await app.inject({ method: 'POST', url: '/login', payload: { nisn: '１２３４５６７８９０', pin: '0000' } });
    assert.equal(normalizedSameStudent.statusCode, 429);
  } finally {
    await app.close();
  }
});

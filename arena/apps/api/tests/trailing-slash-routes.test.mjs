import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { buildAppOptions } from '../dist/lib/app-options.js';

test('opsi server mengabaikan garis miring di akhir path', () => {
  const options = buildAppOptions({ logLevel: 'silent', trustProxy: false, requestTimeoutMs: 30_000 });
  assert.equal(options.routerOptions?.ignoreTrailingSlash, true);
  assert.equal(options.bodyLimit, 64 * 1024);
  assert.equal(options.keepAliveTimeout, 5_000);
});

test('daftar ujian tetap dilayani ketika proxy menambah garis miring', async () => {
  // nginx dengan `location ^~ /api/student/exams/` mengalihkan (301)
  // /api/student/exams ke /api/student/exams/. Tanpa ignoreTrailingSlash
  // Fastify menjawab 404 sehingga siswa tidak pernah melihat jadwal ujian.
  const app = Fastify(buildAppOptions({ logLevel: 'silent', trustProxy: false, requestTimeoutMs: 30_000 }));
  app.get('/api/student/exams', async () => [{ id: 999999 }]);
  try {
    const plain = await app.inject({ method: 'GET', url: '/api/student/exams' });
    const slashed = await app.inject({ method: 'GET', url: '/api/student/exams/' });
    assert.equal(plain.statusCode, 200);
    assert.equal(slashed.statusCode, 200, 'path berganda garis miring harus dilayani route yang sama');
    assert.deepEqual(slashed.json(), plain.json());
  } finally {
    await app.close();
  }
});

test('route dengan garis miring sendiri tetap bisa diakses', async () => {
  const app = Fastify(buildAppOptions({ logLevel: 'silent', trustProxy: false, requestTimeoutMs: 30_000 }));
  app.get('/api/student/exams/:id/result', async () => ({ status: 'FINISHED' }));
  try {
    const ok = await app.inject({ method: 'GET', url: '/api/student/exams/1/result' });
    const extra = await app.inject({ method: 'GET', url: '/api/student/exams/1/result/' });
    assert.equal(ok.statusCode, 200);
    assert.equal(extra.statusCode, 200);
  } finally {
    await app.close();
  }
});

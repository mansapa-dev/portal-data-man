import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL = 'mysql://dummy:dummy@127.0.0.1:1/arena_test';
process.env.AUTH_DB_POOL_SIZE = '4';
process.env.AUTH_DB_QUEUE_LIMIT = '240';
const db = await import('../dist/lib/db.js');

test('login memakai pool auth terpisah yang lazy dan bisa ditutup sendiri', async () => {
  assert.ok(db.pool, 'pool utama tetap dibuat saat modul dimuat');
  const auth = db.getAuthPool();
  assert.ok(auth, 'pool auth dibuat saat pertama dibutuhkan');
  assert.notEqual(auth, db.pool, 'pool auth tidak boleh berbagi koneksi dengan pool ujian');
  assert.equal(db.getAuthPool(), auth, 'pool auth dipakai ulang antar request');
  assert.equal(auth.pool.config.connectionLimit, 4);
  assert.equal(auth.pool.config.queueLimit, 240);

  await db.closeAuthPool();
  const fresh = db.getAuthPool();
  assert.ok(fresh, 'setelah shutdown pool auth bisa dibuat ulang');
  assert.notEqual(fresh, auth);
  await db.closeAuthPool();
});

test('tanpa DATABASE_URL login memberi 503, bukan crash', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const isolated = await import('../dist/lib/db.js?no-database');
    assert.equal(isolated.pool, null);
    assert.equal(isolated.getAuthPool(), null);
    assert.throws(
      () => isolated.requireAuthPool(),
      (error) => error.statusCode === 503 && /Database is not configured/.test(error.message),
    );
  } finally {
    process.env.DATABASE_URL = previous;
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExamQuestionSource, parseStoredPayload, payloadKey } from '../dist/services/exam-question-source.js';

function fakeRedis({ ready = true, fail = false } = {}) {
  const store = new Map();
  const calls = { get: 0, set: 0 };
  return {
    status: ready ? 'ready' : 'connecting',
    store,
    calls,
    async get(key) {
      calls.get++;
      if (fail) throw new Error('redis down');
      return store.get(key) ?? null;
    },
    async set(key, value, mode, ttl) {
      calls.set++;
      if (fail) throw new Error('redis down');
      assert.equal(mode, 'PX');
      assert.ok(Number.isFinite(ttl) && ttl > 0, 'TTL PX harus positif');
      store.set(key, value);
      return 'OK';
    },
  };
}

function row(id, text) { return { id, question_text: text }; }

function source({ now = 0 } = {}) {
  const state = { nowMs: now };
  return { state, clock: () => state.nowMs };
}

test('cache hit: load berulang revision sama tidak memanggil fetchRows lagi', async () => {
  const redis = fakeRedis();
  const { state, clock } = source();
  const src = createExamQuestionSource({ redis, now: clock, localTtlMs: 5_000, redisTtlMs: 60_000 });
  let fetches = 0;
  const fetchRows = async () => { fetches++; return [row(1, 'soal')]; };
  const first = await src.load(7, fetchRows, 1);
  assert.equal(fetches, 1);
  state.nowMs += 1_000;
  const second = await src.load(7, fetchRows, 1);
  assert.equal(fetches, 1); // dilayani dari cache lokal
  assert.equal(second, first);
});

test('revision berubah: payload lama tidak pernah disajikan, fetch ulang', async () => {
  const redis = fakeRedis();
  const { clock } = source();
  const src = createExamQuestionSource({ redis, now: clock, localTtlMs: 60_000, redisTtlMs: 60_000 });
  let fetches = 0;
  const rowsPerRevision = new Map([[1, [row(1, 'lama')]], [2, [row(1, 'baru')]]]);
  const fetchRows = async () => rowsPerRevision.get(++fetches);
  const stale = await src.load(7, fetchRows, 1);
  assert.deepEqual(stale, [row(1, 'lama')]);
  const fresh = await src.load(7, fetchRows, 2);
  assert.deepEqual(fresh, [row(1, 'baru')]);
  // key revision baru terpisah di Redis
  assert.ok(redis.store.has(payloadKey(1, 7)));
  assert.ok(redis.store.has(payloadKey(2, 7)));
  // load ulang revision 1 tetap memberi data revision 1 (dari Redis), bukan data revision 2
  const again = await src.load(7, async () => { throw new Error('tidak boleh fetch ulang'); }, 1);
  assert.deepEqual(again, [row(1, 'lama')]);
});

test('50 request bersamaan revision sama -> fetchRows tepat satu kali', async () => {
  const redis = fakeRedis();
  const { clock } = source();
  const src = createExamQuestionSource({ redis, now: clock, localTtlMs: 5_000, redisTtlMs: 60_000 });
  let fetches = 0;
  const fetchRows = async () => { fetches++; await new Promise((resolve) => setTimeout(resolve, 20)); return [row(1, 'soal')]; };
  const results = await Promise.all(Array.from({ length: 50 }, () => src.load(9, fetchRows, 5)));
  assert.equal(fetches, 1);
  assert.ok(results.every((value) => value.length === 1));
});

test('payload di Redis dengan revision beda dianggap miss (anti korupsi)', async () => {
  const redis = fakeRedis();
  const { clock } = source();
  const src = createExamQuestionSource({ redis, now: clock, localTtlMs: 0, redisTtlMs: 60_000 });
  redis.store.set(payloadKey(3, 11), JSON.stringify({ revision: 2, rows: [row(1, 'usang')] }));
  let fetches = 0;
  const result = await src.load(11, async () => { fetches++; return [row(1, 'segar')]; }, 3);
  assert.equal(fetches, 1);
  assert.deepEqual(result, [row(1, 'segar')]);
});

test('parseStoredPayload menolak payload rusak/revision salah/kosong', () => {
  assert.equal(parseStoredPayload('bukan-json', 1), null);
  assert.equal(parseStoredPayload(JSON.stringify({ revision: 9, rows: [{}] }), 1), null);
  assert.equal(parseStoredPayload(JSON.stringify({ revision: 1, rows: [] }), 1), null);
  assert.deepEqual(parseStoredPayload(JSON.stringify({ revision: 1, rows: [{ id: 1 }] }), 1), [{ id: 1 }]);
});

test('Redis error/unavailable -> fallback DB tanpa throw, tanpa SET', async () => {
  const failing = fakeRedis({ fail: true });
  const { clock } = source();
  const src = createExamQuestionSource({ redis: failing, now: clock, localTtlMs: 0, redisTtlMs: 60_000 });
  let fetches = 0;
  const result = await src.load(4, async () => { fetches++; return [row(1, 'db')]; }, 8);
  assert.equal(fetches, 1);
  assert.deepEqual(result, [row(1, 'db')]);

  const offline = fakeRedis({ ready: false });
  const src2 = createExamQuestionSource({ redis: offline, now: clock, localTtlMs: 0, redisTtlMs: 60_000 });
  const result2 = await src2.load(4, async () => [row(2, 'db')], 8);
  assert.deepEqual(result2, [row(2, 'db')]);
  assert.equal(offline.calls.set, 0);
});

test('tanpa revision authoritative (migrasi belum jalan) -> bypass total cache', async () => {
  const redis = fakeRedis();
  const { clock } = source();
  const src = createExamQuestionSource({ redis, now: clock, localTtlMs: 60_000, redisTtlMs: 60_000 });
  let fetches = 0;
  const fetchRows = async () => { fetches++; return [row(1, 'db')]; };
  await src.load(6, fetchRows, undefined);
  await src.load(6, fetchRows, undefined);
  assert.equal(fetches, 2); // tidak pernah di-cache
  assert.equal(redis.calls.get, 0);
  assert.equal(redis.calls.set, 0);
  await src.load(6, fetchRows, NaN);
  await src.load(6, fetchRows, -1);
  assert.equal(fetches, 4);
});

test('expired cache lokal -> diisi ulang dari Redis tanpa fetchRows', async () => {
  const redis = fakeRedis();
  const { state, clock } = source();
  const src = createExamQuestionSource({ redis, now: clock, localTtlMs: 1_000, redisTtlMs: 60_000 });
  let fetches = 0;
  const fetchRows = async () => { fetches++; return [row(1, 'soal')]; };
  await src.load(12, fetchRows, 4);
  state.nowMs += 2_000; // cache lokal kedaluwarsa
  const again = await src.load(12, fetchRows, 4);
  assert.equal(fetches, 1); // Redis masih memegang payload revision 4
  assert.deepEqual(again, [row(1, 'soal')]);
});

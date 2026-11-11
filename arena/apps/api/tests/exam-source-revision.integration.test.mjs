import assert from 'node:assert/strict';
import test from 'node:test';
import { Redis } from 'ioredis';
import mysql from 'mysql2/promise';
import { createExamQuestionSource, asRedisLike, payloadKey, QUESTION_SOURCE_SELECT } from '../dist/services/exam-question-source.js';

// Integrasi menyeluruh untuk revision authoritative + pre-warm.
// Butuh MySQL dan Redis sekali pakai; jalankan manual dengan env:
//   ARENA_SOURCE_TEST_DB=mysql://user:pass@127.0.0.1:3308/arena
//   ARENA_SOURCE_TEST_REDIS=redis://127.0.0.1:6379
// Tanpa env tersebut, seluruh test di file ini di-skip (CI/unit tetap jalan).
const dbUrl = process.env.ARENA_SOURCE_TEST_DB;
const redisUrl = process.env.ARENA_SOURCE_TEST_REDIS;

test('revision authoritative + pre-warm di MySQL dan Redis nyata', { skip: !dbUrl || !redisUrl }, async () => {
  const db = await mysql.createConnection(dbUrl);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const now = Date.now();
  const tag = `TRGINT${now}`;
  let examA; let examB;
  try {
    await db.execute("INSERT INTO exams(public_id,name,grade,duration_minutes,session_number,starts_at,ends_at,academic_year,semester,status) VALUES(?,?,?,?,?,?,?,?,?,'DRAFT')", [`${tag}A`, tag, 'X', 60, 1, new Date(), new Date(Date.now() + 86400_000), '2026/2027', 'ODD']);
    await db.execute("INSERT INTO exams(public_id,name,grade,duration_minutes,session_number,starts_at,ends_at,academic_year,semester,status) VALUES(?,?,?,?,?,?,?,?,?,'DRAFT')", [`${tag}B`, tag, 'X', 60, 1, new Date(), new Date(Date.now() + 86400_000), '2026/2027', 'ODD']);
    // (baca ulang dengan pola sederhana)
    const [rowsA] = await db.execute('SELECT id,source_revision FROM exams WHERE public_id=?', [`${tag}A`]);
    const [rowsB] = await db.execute('SELECT id,source_revision FROM exams WHERE public_id=?', [`${tag}B`]);
    examA = Number(rowsA[0].id);
    examB = Number(rowsB[0].id);
    const revisionA0 = Number(rowsA[0].source_revision);
    const revisionB0 = Number(rowsB[0].source_revision);

    const src = createExamQuestionSource({ redis: asRedisLike(redis), localTtlMs: 0 });

    // 1. INSERT -> revision +1
    await db.execute('INSERT INTO questions(public_id,exam_id,question_type,question_text,correct_answer,points) VALUES(?,?,?,?,?,1)', [`${tag}Q1`, examA, 'MULTIPLE_CHOICE', 'pertanyaan 1', 'A']);
    const [afterInsert] = await db.execute('SELECT source_revision FROM exams WHERE id=?', [examA]);
    assert.equal(Number(afterInsert[0].source_revision), revisionA0 + 1);

    // 2. Pre-warm -> payload revision terkini ada di Redis, cache lokal terisi
    const outcome = await src.prewarm(examA, db);
    assert.equal(outcome, 'warmed');
    const revisionA1 = Number(afterInsert[0].source_revision);
    const stored = await redis.get(payloadKey(revisionA1, examA));
    assert.ok(stored, 'payload revision terbaru harus ada di Redis');
    const payload = JSON.parse(stored);
    assert.equal(payload.revision, revisionA1);
    assert.ok(payload.rows.some((row) => String(row.question_text) === 'pertanyaan 1'));
    // kunci jawaban ada di payload internal Redis (server-side), bukan di response publik
    assert.ok(payload.rows.some((row) => String(row.correct_answer) === 'A'));

    // 3. UPDATE soal (tanpa pindah exam) -> revision +1, key lama tidak pernah dilayani lagi
    await db.execute('UPDATE questions SET question_text=? WHERE public_id=?', ['pertanyaan 1b', `${tag}Q1`]);
    const [afterUpdate] = await db.execute('SELECT source_revision FROM exams WHERE id=?', [examA]);
    const revisionA2 = Number(afterUpdate[0].source_revision);
    assert.equal(revisionA2, revisionA1 + 1);
    const refetched = await src.load(examA, async () => {
      const [rows] = await db.execute(QUESTION_SOURCE_SELECT, [examA]);
      return rows;
    }, revisionA2);
    assert.ok(refetched.some((row) => String(row.question_text) === 'pertanyaan 1b'));
    // key revision lama masih ada tapi tidak akan diminta lagi (addressing by revision)
    assert.equal(await redis.get(payloadKey(revisionA1, examA)), stored);

    // 4. UPDATE pindah exam_id A->B -> KEDUA exam naik
    await db.execute('UPDATE questions SET exam_id=? WHERE public_id=?', [examB, `${tag}Q1`]);
    const [revA3] = await db.execute('SELECT source_revision FROM exams WHERE id=?', [examA]);
    const [revB3] = await db.execute('SELECT source_revision FROM exams WHERE id=?', [examB]);
    assert.equal(Number(revA3[0].source_revision), revisionA2 + 1);
    assert.equal(Number(revB3[0].source_revision), revisionB0 + 1);

    // 5. DELETE soal -> revision exam tujuan +1
    await db.execute('DELETE FROM questions WHERE public_id=?', [`${tag}Q1`]);
    const [revB4] = await db.execute('SELECT source_revision FROM exams WHERE id=?', [examB]);
    assert.equal(Number(revB4[0].source_revision), revisionB0 + 2);

    // 6. ROLLBACK transaksi -> revision tidak naik
    const [beforeRollback] = await db.execute('SELECT source_revision FROM exams WHERE id=?', [examA]);
    await db.beginTransaction();
    try {
      await db.execute('INSERT INTO questions(public_id,exam_id,question_type,question_text,correct_answer,points) VALUES(?,?,?,?,?,1)', [`${tag}QR`, examA, 'MULTIPLE_CHOICE', 'dibatalkan', 'A']);
      await db.rollback();
    } catch (error) { await db.rollback().catch(() => {}); throw error; }
    const [afterRollback] = await db.execute('SELECT source_revision FROM exams WHERE id=?', [examA]);
    assert.equal(Number(afterRollback[0].source_revision), Number(beforeRollback[0].source_revision));

    // 7. Bulk multi-row lintas exam dalam satu statement -> kedua exam naik
    const [beforeBulkA] = await db.execute('SELECT source_revision FROM exams WHERE id=?', [examA]);
    const [beforeBulkB] = await db.execute('SELECT source_revision FROM exams WHERE id=?', [examB]);
    await db.query('INSERT INTO questions(public_id,exam_id,question_type,question_text,correct_answer,points) VALUES(?,?,?,?,?,1),(?,?,?,?,?,1)', [`${tag}M1`, examA, 'MULTIPLE_CHOICE', 'm1', 'A', `${tag}M2`, examB, 'MULTIPLE_CHOICE', 'm2', 'A']);
    const [afterBulkA] = await db.execute('SELECT source_revision FROM exams WHERE id=?', [examA]);
    const [afterBulkB] = await db.execute('SELECT source_revision FROM exams WHERE id=?', [examB]);
    assert.equal(Number(afterBulkA[0].source_revision), Number(beforeBulkA[0].source_revision) + 1);
    assert.equal(Number(afterBulkB[0].source_revision), Number(beforeBulkB[0].source_revision) + 1);

    // 8. Dua pre-warm bersamaan: tepat satu 'warmed', lainnya 'skipped' (lock)
    const [freshA] = await db.execute('SELECT source_revision FROM exams WHERE id=?', [examA]);
    const sourceA = createExamQuestionSource({ redis: asRedisLike(redis), localTtlMs: 0 });
    const outcomes = await Promise.all([sourceA.prewarm(examA, db), sourceA.prewarm(examA, db)]);
    assert.equal(outcomes.filter((value) => value === 'warmed').length, 1);
    assert.ok(await redis.get(payloadKey(Number(freshA[0].source_revision), examA)));

    // 9. Redis unavailable -> prewarm 'unavailable', loader tetap DB-authoritative
    const offlineClient = new Redis('redis://127.0.0.1:1', { lazyConnect: false, maxRetriesPerRequest: 1, commandTimeout: 200 });
    const offline = createExamQuestionSource({ redis: asRedisLike(offlineClient), localTtlMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 400)); // beri waktu koneksi gagal
    assert.equal(await offline.prewarm(examA, db), 'unavailable');
    const viaOffline = await offline.load(examA, async () => {
      const [rows] = await db.execute(QUESTION_SOURCE_SELECT, [examA]);
      return rows;
    }, Number(freshA[0].source_revision));
    assert.ok(viaOffline.length >= 1);
    offlineClient.disconnect();
  } finally {
    if (examA) await db.execute('DELETE FROM exams WHERE id=?', [examA]).catch(() => {});
    if (examB) await db.execute('DELETE FROM exams WHERE id=?', [examB]).catch(() => {});
    await db.end();
    redis.disconnect();
  }
});

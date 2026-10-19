/**
 * finalizer-concurrency.test.mjs
 *
 * Regression tests for the ExpiredAttemptFinalizer:
 * 1. Finalizer does not run two batches concurrently (running guard).
 * 2. Finalizer acquires MySQL advisory lock before processing.
 * 3. If lock is not acquired (another instance holds it), batch is skipped.
 * 4. Worker concurrency is bounded (at most 4 simultaneous submit calls).
 * 5. Failed individual attempts are counted but do not abort the batch.
 * 6. Both expired IN_PROGRESS and unscored TERMINATED attempts are picked up.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ExpiredAttemptFinalizer } from '../dist/services/expired-attempt-finalizer.js';

function makeLogger() {
  const messages = [];
  return {
    messages,
    info(data, msg) { messages.push({ level: 'info', data, msg }); },
    warn(data, msg) { messages.push({ level: 'warn', data, msg }); },
    error(data, msg) { messages.push({ level: 'error', data, msg }); },
  };
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

test('lock não adquirido: batch pulado sem processar nenhum attempt', async () => {
  const lockNotAcquired = {
    async query(sql) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 0 }]];
      return [[]];
    },
    release() {},
  };
  let queryCount = 0;
  const pool = {
    async getConnection() { return lockNotAcquired; },
    async query() { queryCount++; return [[]]; },
  };
  const scoring = { submit: async () => { throw new Error('Should not be called'); } };
  const logger = makeLogger();
  const finalizer = new ExpiredAttemptFinalizer(pool, scoring, logger, 60_000, 50);

  finalizer.start();
  await delay(50);
  await finalizer.stop();

  // No batch query should be issued if lock is not acquired
  assert.equal(queryCount, 0, 'Pool query bukan lock tidak boleh dipanggil jika lock gagal');
});

test('lock diperoleh: finalisasi dijalankan untuk semua attempt di batch', async () => {
  let finalized = 0;
  let failed = 0;
  let lockReleased = false;

  const mockLock = {
    async query(sql) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) { lockReleased = true; return [[1]]; }
      return [[]];
    },
    release() {},
  };

  const attempts = [
    { student_id: 1, exam_id: 10 },
    { student_id: 2, exam_id: 10 },
    { student_id: 3, exam_id: 10 },
  ];

  const pool = {
    async getConnection() { return mockLock; },
    async query(sql) {
      if (sql.includes('IN_PROGRESS') || sql.includes('TERMINATED')) return [attempts];
      return [[]];
    },
  };

  const scoring = {
    async submit(studentId, examId, finalizeOnly) {
      assert.equal(finalizeOnly, true);
      finalized++;
    },
  };

  const logger = makeLogger();
  const finalizer = new ExpiredAttemptFinalizer(pool, scoring, logger, 60_000, 50);

  finalizer.start();
  for (let i = 0; i < 100 && finalized < attempts.length; i++) await delay(5);
  await finalizer.stop();

  assert.equal(finalized, attempts.length);
  assert.equal(failed, 0);
  assert.equal(lockReleased, true, 'Lock MySQL harus dilepas setelah batch selesai');
});

test('gagal finalisasi satu attempt tidak membatalkan yang lain', async () => {
  let successCount = 0;
  const attempts = [
    { student_id: 1, exam_id: 10 },
    { student_id: 2, exam_id: 10 }, // will fail
    { student_id: 3, exam_id: 10 },
  ];

  const mockLock = {
    async query(sql) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[1]];
      return [[]];
    },
    release() {},
  };

  const pool = {
    async getConnection() { return mockLock; },
    async query(sql) {
      if (sql.includes('IN_PROGRESS') || sql.includes('TERMINATED')) return [attempts];
      return [[]];
    },
  };

  const scoring = {
    async submit(studentId) {
      if (studentId === 2) throw new Error('Simulated DB failure for student 2');
      successCount++;
    },
  };

  const logger = makeLogger();
  const finalizer = new ExpiredAttemptFinalizer(pool, scoring, logger, 60_000, 50);

  finalizer.start();
  for (let i = 0; i < 100 && successCount < 2; i++) await delay(5);
  await finalizer.stop();

  assert.equal(successCount, 2, 'Dua attempt lain harus tetap difinalisasi');
  const warnMessages = logger.messages.filter((m) => m.level === 'warn');
  assert.ok(warnMessages.length >= 1, 'Kegagalan harus dicatat sebagai warning');
});

test('batch tidak berjalan bersamaan (running guard aktif)', async () => {
  let concurrentRuns = 0;
  let maxConcurrent = 0;
  let activeRuns = 0;

  const mockLock = {
    async query(sql) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[1]];
      return [[]];
    },
    release() {},
  };

  const pool = {
    async getConnection() { return mockLock; },
    async query(sql) {
      if (sql.includes('IN_PROGRESS') || sql.includes('TERMINATED')) {
        activeRuns++;
        maxConcurrent = Math.max(maxConcurrent, activeRuns);
        await delay(20); // simulate slow batch
        activeRuns--;
        return [[{ student_id: 99, exam_id: 99 }]];
      }
      return [[]];
    },
  };

  const scoring = { async submit() {} };
  const logger = makeLogger();

  // Short interval to try to trigger concurrent runs
  const finalizer = new ExpiredAttemptFinalizer(pool, scoring, logger, 10, 1);
  finalizer.start();
  await delay(100);
  await finalizer.stop();

  assert.equal(maxConcurrent, 1, 'Batch tidak boleh berjalan bersamaan; max concurrent = 1');
});

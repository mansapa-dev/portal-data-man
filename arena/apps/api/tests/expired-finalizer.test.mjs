import assert from 'node:assert/strict';
import test from 'node:test';
import { ExpiredAttemptFinalizer } from '../dist/services/expired-attempt-finalizer.js';

test('finalizer mengambil attempt terminated tanpa result untuk recovery', async () => {
  let query = '';
  let finalized = 0;
  const lock = {
    async query(sql) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      return [[]];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async execute(sql) {
      // Route claimSubmission (urutan: attempt lock → submission → results).
      if (sql.startsWith('SELECT id FROM exam_attempts WHERE student_id')) return [[{ id: 1 }]];
      if (sql.startsWith('SELECT state,skip_reason FROM exam_submissions')) return [[]];
      if (sql.startsWith('SELECT COUNT(*) n FROM exam_results')) return [[{ n: 0 }]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async getConnection() { return lock; },
    async execute(sql) {
      // Self-heal DONE-tanpa-hasil: tidak ada baris yang memenuhi syarat.
      if (sql.startsWith("UPDATE exam_submissions s SET s.state='RECEIVED'")) return [{ affectedRows: 0 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async query(sql) {
      if (sql.startsWith('SELECT s.student_id, s.exam_id FROM exam_submissions')) return [[]];
      query = sql;
      return [[{ student_id: 7, exam_id: 12 }]];
    },
  };
  const scoring = {
    async submit(studentId, examId, finalizeOnly) {
      assert.equal(studentId, 7);
      assert.equal(examId, 12);
      assert.equal(finalizeOnly, true);
      finalized++;
    },
  };
  const logger = { info() {}, warn() {}, error() {} };
  const finalizer = new ExpiredAttemptFinalizer(pool, scoring, logger, 60_000, 50);

  finalizer.start();
  for (let attempt = 0; attempt < 50 && finalized === 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  await finalizer.stop();

  assert.equal(finalized, 1);
  assert.match(query, /status='TERMINATED'/);
  assert.match(query, /NOT EXISTS\s*\(\s*SELECT 1 FROM exam_results/);
});

test('finalizer menguras beberapa batch dalam satu putaran (mass expiry)', async () => {
  const rows = [
    { student_id: 1, exam_id: 9 },
    { student_id: 2, exam_id: 9 },
    { student_id: 3, exam_id: 9 },
  ];
  let batchCalls = 0;
  const lock = {
    async query(sql) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      return [[]];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async execute(sql) {
      if (sql.startsWith('SELECT id FROM exam_attempts WHERE student_id')) return [[{ id: 1 }]];
      if (sql.startsWith('SELECT state,skip_reason FROM exam_submissions')) return [[]];
      if (sql.startsWith('SELECT COUNT(*) n FROM exam_results')) return [[{ n: 0 }]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async getConnection() { return lock; },
    async execute(sql) {
      if (sql.startsWith("UPDATE exam_submissions s SET s.state='RECEIVED'")) return [{ affectedRows: 0 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async query(sql) {
      if (sql.startsWith('SELECT s.student_id, s.exam_id FROM exam_submissions')) return [[]];
      // Batch pertama penuh (2 baris) → lanjut; batch kedua 1 baris → selesai.
      batchCalls++;
      return [batchCalls === 1 ? rows.slice(0, 2) : rows.slice(2)];
    },
  };
  const submitted = [];
  const scoring = { async submit(studentId) { submitted.push(studentId); } };
  const logger = { info() {}, warn() {}, error() {} };
  const finalizer = new ExpiredAttemptFinalizer(pool, scoring, logger, 60_000, 2);

  finalizer.start();
  for (let attempt = 0; attempt < 100 && submitted.length < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  await finalizer.stop();

  assert.deepEqual(submitted.sort((a, b) => a - b), [1, 2, 3]);
  assert.equal(batchCalls, 2);
});

test('finalizer berhenti mencoba bila satu batch tidak menghasilkan progres', async () => {
  let batchCalls = 0;
  let failures = 0;
  const lock = {
    async query(sql) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      return [[]];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async execute(sql) {
      if (sql.startsWith('SELECT id FROM exam_attempts WHERE student_id')) return [[{ id: 1 }]];
      if (sql.startsWith('SELECT state,skip_reason FROM exam_submissions')) return [[]];
      if (sql.startsWith('SELECT COUNT(*) n FROM exam_results')) return [[{ n: 0 }]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async getConnection() { return lock; },
    async execute(sql) {
      if (sql.startsWith("UPDATE exam_submissions s SET s.state='RECEIVED'")) return [{ affectedRows: 0 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async query(sql) {
      if (sql.startsWith('SELECT s.student_id, s.exam_id FROM exam_submissions')) return [[]];
      batchCalls++;
      // Selalu mengembalikan baris yang gagal permanen.
      return [[{ student_id: 5, exam_id: 9 }]];
    },
  };
  const scoring = { async submit() { failures++; throw new Error('snapshot hilang'); } };
  const logger = { info() {}, warn() {}, error() {} };
  const finalizer = new ExpiredAttemptFinalizer(pool, scoring, logger, 60_000, 1);

  finalizer.start();
  for (let attempt = 0; attempt < 100 && failures === 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  await finalizer.stop();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(failures, 1, 'baris gagal tidak boleh diulang terus dalam satu putaran');
  assert.equal(batchCalls, 1);
});

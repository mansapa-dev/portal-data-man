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
    release() {},
  };
  const pool = {
    async getConnection() { return lock; },
    async query(sql) {
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

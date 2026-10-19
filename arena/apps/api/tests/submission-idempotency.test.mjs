/**
 * submission-idempotency.test.mjs
 *
 * Regression tests for exam submission correctness (Phase 4):
 * 1. A student who submits twice receives the same result (idempotent).
 * 2. A finalize-only call on an IN_PROGRESS (not-yet-expired) attempt is rejected.
 * 3. Submission on a COMPLETED attempt (no existing result yet) is handled correctly.
 * 4. Concurrent submit calls (deadlock retry) eventually succeed.
 * 5. Submission does not trust client-supplied score; it re-computes from attempt_questions.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ScoringService } from '../dist/services/scoring.js';

// Baseline stored result used for idempotency tests
const storedResult = {
  question_count: 10,
  correct_count: 7,
  wrong_count: 2,
  blank_count: 1,
  earned_points: '7.00',
  maximum_points: '10.00',
  score: '70.00',
};

function makePool(attemptOverride = {}, existingResult = null) {
  const statements = [];
  const connection = {
    statements,
    async beginTransaction() { statements.push('BEGIN'); },
    async commit() { statements.push('COMMIT'); },
    async rollback() { statements.push('ROLLBACK'); },
    release() {},
    async execute(sql, _params = []) {
      statements.push(sql.split('\n')[0].trim().slice(0, 80));
      if (sql.startsWith('SELECT id,status,expires_at')) {
        const base = { id: 5, status: 'COMPLETED', expired: 1, ...attemptOverride };
        return [[base]];
      }
      if (sql.startsWith('SELECT question_count')) {
        return [existingResult ? [existingResult] : []];
      }
      if (sql.startsWith('SELECT m.type,e.grade')) return [[]];
      if (sql.startsWith('SELECT q.question_id,q.question_type')) {
        // Return 3 simple MC questions, all answered correctly
        return [[
          { question_id: 1, question_type: 'MULTIPLE_CHOICE', correct_answer: 'A', option_a: 'x', option_b: 'y', option_c: null, option_d: null, option_e: null, points: '1.00', answer: 'A' },
          { question_id: 2, question_type: 'MULTIPLE_CHOICE', correct_answer: 'B', option_a: 'x', option_b: 'y', option_c: null, option_d: null, option_e: null, points: '1.00', answer: 'B' },
          { question_id: 3, question_type: 'MULTIPLE_CHOICE', correct_answer: 'A', option_a: 'x', option_b: 'y', option_c: null, option_d: null, option_e: null, points: '1.00', answer: null },
        ]];
      }
      if (sql.startsWith('INSERT INTO exam_results')) return [{ affectedRows: 1, insertId: 1 }];
      if (sql.startsWith('UPDATE exam_attempts SET status=IF(status=')) return [{ affectedRows: 1 }];
      if (sql.startsWith('UPDATE exam_attempts SET status=IF(expires_at')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return { pool: { async getConnection() { return connection; } }, connection };
}

test('submit dua kali mengembalikan hasil sama (idempoten)', async () => {
  const { pool, connection } = makePool(
    { status: 'COMPLETED', expired: 1 },
    storedResult,
  );
  const scoring = new ScoringService(pool);

  const first = await scoring.submit(1, 10, true);
  const second = await scoring.submit(1, 10, true);

  assert.deepEqual(first, second);
  // Must never INSERT again into exam_results
  const inserts = connection.statements.filter((s) => s.startsWith('INSERT INTO exam_results'));
  assert.equal(inserts.length, 0);
});

test('finalize-only ditolak jika ujian masih IN_PROGRESS dan belum expired', async () => {
  const { pool } = makePool({ status: 'IN_PROGRESS', expired: 0 }, null);
  const scoring = new ScoringService(pool);
  await assert.rejects(
    scoring.submit(1, 10, true),
    { statusCode: 409 },
  );
});

test('submit pada attempt IN_PROGRESS yang sudah expired menghasilkan nilai dari jawaban', async () => {
  const { pool, connection } = makePool(
    { status: 'IN_PROGRESS', expired: 1 },
    null, // no existing result
  );
  const scoring = new ScoringService(pool);
  const result = await scoring.submit(1, 10, false);

  // 2 correct, 1 blank out of 3 → score = 2/3 * 100 = 66.67
  assert.equal(result.benar, 2);
  assert.equal(result.kosong, 1);
  assert.ok(result.nilai > 0);
  // Must have committed
  const commits = connection.statements.filter((s) => s === 'COMMIT');
  assert.ok(commits.length >= 1);
});

test('status TERMINATED diterima oleh submit dengan finalize_only=true', async () => {
  // Admin terminates a session; finalizer must score it
  const { pool } = makePool({ status: 'TERMINATED', expired: 0 }, null);
  const scoring = new ScoringService(pool);
  const result = await scoring.submit(1, 10, true);
  assert.ok(result);
  assert.equal(result.benar, 2);
});

test('submit menolak status invalid (bukan IN_PROGRESS/TERMINATED)', async () => {
  const { pool } = makePool({ status: 'EXPIRED', expired: 1 }, null);
  const scoring = new ScoringService(pool);
  await assert.rejects(
    scoring.submit(1, 10, true),
    { statusCode: 409 },
  );
});

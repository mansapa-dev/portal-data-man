/**
 * answer-mutation-ordering.test.mjs
 *
 * Regression tests for autosave correctness invariants (Phase 3):
 * 1. Stale base_revision must be rejected.
 * 2. Duplicate mutation_id with identical payload is idempotent (duplicate:true).
 * 3. Duplicate mutation_id with conflicting payload must be rejected (409).
 * 4. An expired/completed attempt must reject new writes.
 * 5. An invalid answer letter for MULTIPLE_CHOICE must be rejected (422).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { StudentExamService } from '../dist/services/student-exam.js';

// Build a minimal mock pool + connection for saveAnswer testing.
// The connection returned by saveAnswer internally only needs to support
// beginTransaction, commit, rollback, release, and execute.
function buildPool({ attemptRow, questionRow, versionRow, answerRow } = {}) {
  const released = { count: 0 };
  const statements = [];

  const connection = {
    released,
    statements,
    async beginTransaction() { statements.push('BEGIN'); },
    async commit() { statements.push('COMMIT'); },
    async rollback() { statements.push('ROLLBACK'); },
    release() { released.count++; },
    async execute(sql, params = []) {
      statements.push({ sql, params });
      // Attempt lock
      if (sql.startsWith('SELECT id,public_id,status,expires_at')) {
        return [attemptRow ? [attemptRow] : []];
      }
      // State query (question + versions + answer)
      if (sql.includes('FROM attempt_questions q')) {
        return [questionRow ? [questionRow] : []];
      }
      // INSERT or UPDATE on student_answers
      if (sql.startsWith('INSERT INTO student_answers') || sql.startsWith('UPDATE student_answers')) {
        return [{ affectedRows: 1 }];
      }
      // answer_write_versions
      if (sql.startsWith('INSERT INTO answer_write_versions') || sql.startsWith('UPDATE answer_write_versions')) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const pool = { async getConnection() { return connection; } };
  return { pool, connection };
}

const baseClaims = { sub: 1, role: 'STUDENT', exp: Math.floor(Date.now() / 1000) + 3600, csrf: 'test' };

const baseAttempt = {
  id: 10,
  public_id: 'ATTEMPT01',
  status: 'IN_PROGRESS',
  expires_at: new Date(Date.now() + 3_600_000),
  expired: 0,
};

const baseQuestion = {
  question_type: 'MULTIPLE_CHOICE',
  option_a_available: 1, option_b_available: 1, option_c_available: 1,
  option_d_available: 1, option_e_available: 0,
  revision: null,
  mutation_id: null,
  answer_id: null,
  answer: null,
  is_flagged: 0,
};

// Helper: builds input for saveAnswer
function makeInput(overrides = {}) {
  return {
    answer: 'A',
    is_flagged: false,
    attempt_id: 'ATTEMPT01',
    base_revision: 0,
    mutation_id: 'mutation-id-1111111111',
    ...overrides,
  };
}

test('jawaban valid disimpan dan mengembalikan revision bertambah', async () => {
  const { pool, connection } = buildPool({
    attemptRow: baseAttempt,
    questionRow: { ...baseQuestion },
  });
  const service = new StudentExamService(pool);
  const result = await service.saveAnswer(baseClaims, 5, 42, makeInput());
  assert.equal(result.revision, 1);
  assert.equal(result.answer, 'A');
  // Connection must be released exactly once
  assert.equal(connection.released.count, 1);
});

test('stale base_revision ditolak dengan 409', async () => {
  // Current revision is 3, client sends base_revision=1 → stale
  const { pool } = buildPool({
    attemptRow: baseAttempt,
    questionRow: { ...baseQuestion, revision: 3, mutation_id: 'old-mutation-id-1234' },
  });
  const service = new StudentExamService(pool);
  await assert.rejects(
    service.saveAnswer(baseClaims, 5, 42, makeInput({ base_revision: 1 })),
    { statusCode: 409 },
  );
});

test('mutation_id duplikat dengan payload sama dikembalikan sebagai duplicate', async () => {
  // The server has already accepted mutation-id-1111111111 with answer='A'
  const { pool } = buildPool({
    attemptRow: baseAttempt,
    questionRow: { ...baseQuestion, revision: 1, mutation_id: 'mutation-id-1111111111', answer: 'A', is_flagged: 0, answer_id: 7 },
  });
  const service = new StudentExamService(pool);
  const result = await service.saveAnswer(
    baseClaims, 5, 42,
    makeInput({ base_revision: 1, mutation_id: 'mutation-id-1111111111', answer: 'A' }),
  );
  assert.equal(result.duplicate, true);
  assert.equal(result.revision, 1);
});

test('mutation_id duplikat dengan payload berbeda ditolak dengan 409', async () => {
  // The server recorded mutation-id-1111111111 with answer='A'; client retries with answer='B'
  const { pool } = buildPool({
    attemptRow: baseAttempt,
    questionRow: { ...baseQuestion, revision: 1, mutation_id: 'mutation-id-1111111111', answer: 'A', is_flagged: 0, answer_id: 7 },
  });
  const service = new StudentExamService(pool);
  await assert.rejects(
    service.saveAnswer(
      baseClaims, 5, 42,
      makeInput({ base_revision: 1, mutation_id: 'mutation-id-1111111111', answer: 'B' }),
    ),
    { statusCode: 409 },
  );
});

test('attempt expired menolak autosave dengan 409', async () => {
  const expiredAttempt = {
    ...baseAttempt,
    status: 'IN_PROGRESS',
    expires_at: new Date(Date.now() - 1000),
    expired: 1,
  };
  const { pool } = buildPool({
    attemptRow: expiredAttempt,
    questionRow: { ...baseQuestion },
  });
  const service = new StudentExamService(pool);
  await assert.rejects(
    service.saveAnswer(baseClaims, 5, 42, makeInput()),
    { statusCode: 409 },
  );
});

test('attempt sudah COMPLETED menolak autosave dengan 409', async () => {
  const completedAttempt = {
    ...baseAttempt,
    status: 'COMPLETED',
    expired: 0,
  };
  const { pool } = buildPool({
    attemptRow: completedAttempt,
    questionRow: { ...baseQuestion },
  });
  const service = new StudentExamService(pool);
  await assert.rejects(
    service.saveAnswer(baseClaims, 5, 42, makeInput()),
    { statusCode: 409 },
  );
});

test('attempt public_id berbeda ditolak dengan 409', async () => {
  const { pool } = buildPool({
    attemptRow: baseAttempt,
    questionRow: { ...baseQuestion },
  });
  const service = new StudentExamService(pool);
  await assert.rejects(
    service.saveAnswer(baseClaims, 5, 42, makeInput({ attempt_id: 'WRONG-ATTEMPT-ID' })),
    { statusCode: 409 },
  );
});

test('pilihan jawaban tidak valid ditolak dengan 422', async () => {
  const { pool } = buildPool({
    attemptRow: baseAttempt,
    questionRow: { ...baseQuestion },
  });
  const service = new StudentExamService(pool);
  // 'E' is not available (option_e_available=0)
  await assert.rejects(
    service.saveAnswer(baseClaims, 5, 42, makeInput({ answer: 'E' })),
    { statusCode: 422 },
  );
});

test('koneksi selalu dilepas meskipun terjadi kesalahan', async () => {
  // Simulate a question not found (empty stateRows)
  const { pool, connection } = buildPool({
    attemptRow: baseAttempt,
    questionRow: null, // triggers 404
  });
  const service = new StudentExamService(pool);
  await assert.rejects(
    service.saveAnswer(baseClaims, 5, 42, makeInput()),
    { statusCode: 404 },
  );
  // Connection MUST be released even on error
  assert.equal(connection.released.count, 1);
});

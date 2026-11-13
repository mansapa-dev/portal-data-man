import assert from 'node:assert/strict';
import test from 'node:test';
import { StudentExamService } from '../dist/services/student-exam.js';

const item = (question_id, answer, mutation_id) => ({
  question_id,
  answer,
  is_flagged: false,
  base_revision: 1,
  mutation_id: mutation_id || `mut_${question_id}_${Date.now()}`,
});

test('saveAnswersBatch: eliminates writes completely when answers are identical (no-op)', async () => {
  let writes = 0;
  let begins = 0;
  let commits = 0;
  let releases = 0;

  const connection = {
    async beginTransaction() { begins++; },
    async commit() { commits++; },
    async rollback() {},
    release() { releases++; },
    async execute(sql) {
      if (sql.includes('FROM exam_attempts')) {
        return [[{ id: 99, public_id: 'A'.repeat(26), status: 'IN_PROGRESS', expired: 0 }]];
      }
      return [[]];
    },
    async query(sql) {
      if (sql.includes('FROM attempt_questions')) {
        // Return existing answers that already match 'A' and 'B' with revision 1
        return [[
          { question_id: 1, question_type: 'MULTIPLE_CHOICE', option_a_available: 1, option_b_available: 1, revision: 1, mutation_id: 'prev_mut_1', answer: 'A', is_flagged: 0 },
          { question_id: 2, question_type: 'MULTIPLE_CHOICE', option_a_available: 1, option_b_available: 1, revision: 1, mutation_id: 'prev_mut_2', answer: 'B', is_flagged: 0 },
        ]];
      }
      if (sql.startsWith('INSERT INTO student_answers') || sql.startsWith('INSERT INTO answer_write_versions')) {
        writes++;
        return [{}];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const pool = {
    getConnection: async () => connection,
    query: async () => [[]],
  };

  const service = new StudentExamService(pool);
  // Send same answers 'A' and 'B' with new mutation_ids
  const result = await service.saveAnswersBatch({ sub: 10 }, 1, {
    attempt_id: 'A'.repeat(26),
    answers: [item(1, 'A', 'new_mut_1'), item(2, 'B', 'new_mut_2')],
  });

  // Revisions returned as 1 without incrementing and ZERO disk writes executed
  assert.deepEqual(result.revisions, { 1: 1, 2: 1 });
  assert.equal(begins, 1);
  assert.equal(commits, 1);
  assert.equal(writes, 0, 'Zero writes should occur when answers are already identical in DB');
  assert.equal(releases, 1);
});

test('saveAnswerOnce: eliminates writes when single answer is identical to stored state', async () => {
  let writes = 0;
  let commits = 0;

  const connection = {
    async beginTransaction() {},
    async commit() { commits++; },
    async rollback() {},
    release() {},
    async execute(sql, params) {
      if (sql.includes('FROM exam_attempts ea')) {
        return [[{
          attempt_id: 99,
          public_id: 'A'.repeat(26),
          attempt_status: 'IN_PROGRESS',
          expires_at: new Date(Date.now() + 60_000),
          expired: 0,
          question_type: 'MULTIPLE_CHOICE',
          option_a_available: 1,
          option_b_available: 1,
          revision: 2,
          mutation_id: 'old_mutation',
          answer_id: 101,
          answer: 'A',
          is_flagged: 0,
        }]];
      }
      if (sql.startsWith('UPDATE student_answers') || sql.startsWith('INSERT INTO student_answers') ||
          sql.startsWith('UPDATE answer_write_versions') || sql.startsWith('INSERT INTO answer_write_versions')) {
        writes++;
        return [{}];
      }
      return [[]];
    },
  };

  const pool = {
    getConnection: async () => connection,
    query: async () => [[]],
  };

  const service = new StudentExamService(pool);
  const result = await service.saveAnswer({ sub: 10 }, 1, 1, {
    attempt_id: 'A'.repeat(26),
    answer: 'A',
    is_flagged: false,
    base_revision: 2,
    mutation_id: 'brand_new_mutation_id_12345',
  });

  assert.equal(result.question_id, 1);
  assert.equal(result.revision, 2);
  assert.equal(writes, 0, 'Zero DML writes should execute when single answer is identical');
  assert.equal(commits, 1);
});

test('heartbeat: throttles database writes within window', async () => {
  let connectionAcquired = 0;
  let dbQueries = 0;

  const connection = {
    release() {},
    async execute(sql) {
      dbQueries++;
      return [{}];
    },
  };

  const pool = {
    getConnection: async () => {
      connectionAcquired++;
      return connection;
    },
  };

  const service = new StudentExamService(pool);
  const studentId = 8888;
  const examId = 77;

  // First heartbeat hits DB
  const first = await service.heartbeat(studentId, examId);
  assert.ok(first.server_time);
  assert.equal(connectionAcquired, 1);
  assert.equal(dbQueries, 1);

  // Second heartbeat immediately after returns server_time without hitting DB pool
  const second = await service.heartbeat(studentId, examId);
  assert.ok(second.server_time);
  assert.equal(connectionAcquired, 1, 'Should NOT acquire connection for throttled heartbeat');
  assert.equal(dbQueries, 1, 'Should NOT execute SQL query for throttled heartbeat');

  // Third heartbeat
  const third = await service.heartbeat(studentId, examId);
  assert.ok(third.server_time);
  assert.equal(connectionAcquired, 1);
  assert.equal(dbQueries, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { StudentExamService } from '../dist/services/student-exam.js';

const item = (question_id, answer) => ({ question_id, answer, is_flagged: false, base_revision: 0, mutation_id: `mutation_${question_id}_1234567890` });

test('two answers use one transaction and two bulk writes', async () => {
  let writes = 0, commits = 0, begins = 0, releases = 0;
  const connection = {
    async beginTransaction() { begins++; }, async commit() { commits++; }, async rollback() {}, release() { releases++; },
    async execute() { return [[{ id: 7, public_id: 'A'.repeat(26), status: 'IN_PROGRESS', expired: 0 }]]; },
    async query(sql) {
      if (sql.includes('FROM attempt_questions')) return [[
        { question_id: 1, question_type: 'MULTIPLE_CHOICE', option_a_available: 1, option_b_available: 1, revision: null, mutation_id: null, answer: null, is_flagged: null },
        { question_id: 2, question_type: 'MULTIPLE_CHOICE', option_a_available: 1, option_b_available: 1, revision: null, mutation_id: null, answer: null, is_flagged: null },
      ]];
      if (sql.startsWith('INSERT INTO student_answers') || sql.startsWith('INSERT INTO answer_write_versions')) { writes++; return [{}]; }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const service = new StudentExamService({ getConnection: async () => connection });
  const result = await service.saveAnswersBatch({ sub: 3 }, 5, { attempt_id: 'A'.repeat(26), answers: [item(1, 'A'), item(2, 'B')] });
  assert.deepEqual(result.revisions, { 1: 1, 2: 1 });
  assert.equal(begins, 1); assert.equal(commits, 1); assert.equal(writes, 2); assert.equal(releases, 1);
});

test('batch rejects new answers after finish without writing', async () => {
  let writes = 0;
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute() { return [[{ id: 7, public_id: 'A'.repeat(26), status: 'COMPLETED', expired: 0 }]]; },
    async query(sql) {
      if (sql.includes('FROM attempt_questions')) return [[{ question_id: 1, question_type: 'MULTIPLE_CHOICE', option_a_available: 1, option_b_available: 1, revision: null, mutation_id: null, answer: null, is_flagged: null }]];
      writes++; return [{}];
    },
  };
  const service = new StudentExamService({ getConnection: async () => connection });
  await assert.rejects(service.saveAnswersBatch({ sub: 3 }, 5, { attempt_id: 'A'.repeat(26), answers: [item(1, 'A')] }), { statusCode: 409 });
  assert.equal(writes, 0);
});

test('retry of a committed mutation stays idempotent after finish', async () => {
  let writes = 0;
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute() { return [[{ id: 7, public_id: 'A'.repeat(26), status: 'COMPLETED', expired: 0 }]]; },
    async query(sql) {
      if (sql.includes('FROM attempt_questions')) return [[{ question_id: 1, question_type: 'MULTIPLE_CHOICE', option_a_available: 1, revision: 1, mutation_id: item(1, 'A').mutation_id, answer: 'A', is_flagged: 0 }]];
      writes++; return [{}];
    },
  };
  const service = new StudentExamService({ getConnection: async () => connection });
  const result = await service.saveAnswersBatch({ sub: 3 }, 5, { attempt_id: 'A'.repeat(26), answers: [item(1, 'A')] });
  assert.deepEqual(result.revisions, { 1: 1 });
  assert.equal(writes, 0);
});

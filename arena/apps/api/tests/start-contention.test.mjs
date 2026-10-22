import assert from 'node:assert/strict';
import test from 'node:test';
import { StudentExamService } from '../dist/services/student-exam.js';

test('start retries a concurrent unique-key winner and resumes its attempt', async () => {
  let preflightReads = 0;
  let insertAttempts = 0;
  const attempts = [];
  const attempt = {
    id: 10,
    public_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    status: 'IN_PROGRESS',
    expires_at: new Date(Date.now() + 60_000),
    can_resume: 1,
    question_order: [42],
    option_mapping: { 42: ['A', 'B'] },
  };
  const connection = {
    async beginTransaction() { attempts.push('BEGIN'); },
    async commit() { attempts.push('COMMIT'); },
    async rollback() { attempts.push('ROLLBACK'); },
    release() { attempts.push('RELEASE'); },
    async execute(sql) {
      attempts.push(sql);
      if (sql.includes('FOR UPDATE') && sql.includes('FROM exam_attempts')) return [[attempt]];
      if (sql.includes('FROM exams e WHERE e.id=?')) return [[{ id: 5, name: 'Exam', duration_minutes: 60, ends_at: new Date(Date.now() + 60_000) }]];
      if (sql.includes('SELECT 1 active FROM exam_attempts')) return [[{ active: 1 }]];
      if (sql.includes('FROM questions WHERE exam_id=?')) return [[{ id: 42, question_type: 'MULTIPLE_CHOICE', question_text: 'Question', option_a: 'A', option_b: 'B', option_c: null, option_d: null, option_e: null, correct_answer: 'A', points: 1 }]];
      if (sql.includes('FROM attempt_questions WHERE attempt_id=?')) return [[{ id: 42, question_type: 'MULTIPLE_CHOICE', question_text: 'Question', option_a: 'A', option_b: 'B', option_c: null, option_d: null, option_e: null, points: 1 }]];
      if (sql.includes('FROM answer_write_versions v')) return [[]];
      if (sql.startsWith('INSERT INTO exam_attempts')) {
        insertAttempts++;
        const error = new Error('concurrent start created this unique key first');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const pool = {
    async execute(sql) {
      if (sql.startsWith('SELECT id,portal_class_id')) return [[{ id: 1, portal_class_id: null, grade_snapshot: 'X' }]];
      if (sql.startsWith('SELECT id FROM exam_attempts')) {
        preflightReads++;
        return [preflightReads === 1 ? [] : [{ id: 10 }]];
      }
      throw new Error(`Unexpected pool SQL: ${sql}`);
    },
    async getConnection() { return connection; },
  };

  const service = new StudentExamService(pool);
  const result = await service.start(1, 5);

  assert.equal(result.attempt_id, attempt.public_id);
  assert.equal(insertAttempts, 1);
  assert.equal(preflightReads, 2);
  assert.equal(attempts.filter((item) => item === 'ROLLBACK').length, 1);
  assert.equal(attempts.filter((item) => item === 'COMMIT').length, 1);
  assert.equal(attempts.filter((item) => typeof item === 'string' && item.includes('FROM exam_attempts') && item.includes('FOR UPDATE')).length, 1);
});

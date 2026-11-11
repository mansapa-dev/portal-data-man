import assert from 'node:assert/strict';
import test from 'node:test';
import { StudentExamService } from '../dist/services/student-exam.js';
import { loadExamQuestionSource } from '../dist/services/exam-question-source.js';

test('concurrent starts share source read and never expose the answer key', async () => {
  const examId = 987654321;
  let sourceReads = 0;
  let insertId = 0;
  const pool = {
    async execute(_sql, [_examId, studentId]) {
      return [[{ id: studentId, portal_class_id: 'X', grade_snapshot: 'X' }]];
    },
    async getConnection() {
      return {
        async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
        async execute(sql) {
          if (sql.includes('FROM exams e')) return [[{ id: examId, name: 'Ujian Dummy', duration_minutes: 60, ends_at: new Date(Date.now() + 3600000), db_now: new Date(), source_revision: 1 }]];
          if (sql.includes('FROM questions WHERE')) {
            sourceReads++;
            await new Promise(resolve => setTimeout(resolve, 20));
            return [[{ id: 1, question_type: 'MULTIPLE_CHOICE', question_text: 'Soal 1', option_a: 'Benar', option_b: 'Salah', option_c: null, option_d: null, option_e: null, correct_answer: 'A', points: 1 }]];
          }
          if (sql.includes('INSERT INTO exam_attempts')) return [{ insertId: ++insertId }];
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        async query(sql, [rows]) {
          assert.match(sql, /INSERT INTO attempt_questions/);
          assert.equal(rows.length, 1);
          assert.equal(rows[0][9].length, 1);
          return [{}];
        },
      };
    },
  };
  const service = new StudentExamService(pool);
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => service.start(i + 1, examId)));
  // Semua start bersamaan memakai revision 1 yang sama -> satu fetch bersama.
  assert.equal(sourceReads, 1);
  for (const response of responses) {
    assert.equal(response.soal.length, 1);
    assert.equal(response.soal[0].pertanyaan, 'Soal 1');
    assert.equal(JSON.stringify(response).includes('correct_answer'), false);
    assert.equal(JSON.stringify(response).includes('"kunci"'), false);
  }
});

test('an in-flight old-revision read cannot refill the new revision cache', async () => {
  const examId = 987654322;
  let release;
  const oldRead = loadExamQuestionSource(examId, () => new Promise(resolve => { release = () => resolve([{ id: 1 }]); }), 1);
  const freshRead = await loadExamQuestionSource(examId, async () => [{ id: 2 }], 2);
  release();
  await oldRead;
  const cachedRead = await loadExamQuestionSource(examId, () => { throw new Error('Stale cache was restored'); }, 2);
  assert.equal(freshRead[0].id, 2);
  assert.equal(cachedRead[0].id, 2);
});

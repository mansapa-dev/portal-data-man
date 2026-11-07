import test from 'node:test';
import assert from 'node:assert/strict';
import { fraction } from '../dist/services/scoring.js';
import { regradeShortAnswerAttempt } from '../dist/services/short-answer-regrade.js';

test('isian singkat menerima alternatif kunci, beda kapital, spasi, dan titik akhir', () => {
  assert.equal(fraction('SHORT_ANSWER', 'buku | kitab', '  KITAB.  ', 0), 1);
  assert.equal(fraction('SHORT_ANSWER', 'rumah sakit', '  Rumah   Sakit... ', 0), 1);
  assert.equal(fraction('SHORT_ANSWER', 'rumah sakit', 'RumahSakit', 0), 1);
  assert.equal(fraction('SHORT_ANSWER', 'buku | kitab', 'bukit', 0), 0);
});

test('hitung ulang memakai kunci terbaru dan memperbarui nilai tersimpan', async () => {
  const changes = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql, params) => {
      if (sql.includes('FROM exam_attempts WHERE id=')) return [[{ id: 7, exam_id: 3, status: 'COMPLETED' }]];
      if (sql.includes('FROM exam_results WHERE attempt_id=')) return [[{ id: 9, correct_count: 0, wrong_count: 1, blank_count: 0, earned_points: 0, score: 0 }]];
      if (sql.startsWith('UPDATE attempt_questions')) return [{ affectedRows: 1 }];
      if (sql.includes('FROM attempt_questions q LEFT JOIN student_answers')) return [[{ question_type: 'SHORT_ANSWER', correct_answer: 'buku|kitab', points: 2, answer: 'KITAB.', option_count: 0 }]];
      if (sql.includes('FROM exam_follow_up_meta')) return [[]];
      if (sql.startsWith('UPDATE exam_results')) { changes.push(params); return [{ affectedRows: 1 }]; }
      throw new Error(`Query tak dikenal: ${sql}`);
    },
  };
  const pool = { getConnection: async () => connection };
  assert.equal(await regradeShortAnswerAttempt(pool, 7, 5), true);
  assert.deepEqual(changes[0], [1, 1, 0, 0, 2, 2, 100, 9]);
});

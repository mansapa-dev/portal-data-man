import assert from 'node:assert/strict';
import test from 'node:test';
import { ScoringService } from '../dist/services/scoring.js';

test('submit mengembalikan hasil tersimpan tanpa menilai atau menulis ulang', async () => {
  const statements = [];
  const result = {
    question_count: 12,
    correct_count: 8,
    wrong_count: 3,
    blank_count: 1,
    earned_points: '8.00',
    maximum_points: '12.00',
    score: '66.67',
  };
  const connection = {
    async beginTransaction() { statements.push('BEGIN'); },
    async commit() { statements.push('COMMIT'); },
    async rollback() { statements.push('ROLLBACK'); },
    release() {},
    async execute(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT id,status,expires_at')) return [[{ id: 41, status: 'COMPLETED', expired: 1 }]];
      if (sql.startsWith('SELECT question_count')) return [[result]];
      if (sql.startsWith('SELECT m.type,e.grade')) return [[]];
      throw new Error(`Unexpected SQL in idempotency path: ${sql}`);
    },
  };
  const pool = { async getConnection() { return connection; } };
  const scoring = new ScoringService(pool);

  const first = await scoring.submit(9, 3, true);
  const second = await scoring.submit(9, 3, true);

  assert.deepEqual(second, first);
  assert.equal(statements.filter((sql) => typeof sql === 'string' && sql.startsWith('INSERT INTO exam_results')).length, 0);
  assert.equal(statements.filter((sql) => typeof sql === 'string' && sql.startsWith('UPDATE exam_attempts')).length, 0);
  assert.equal(statements.filter((sql) => sql === 'COMMIT').length, 2);
});

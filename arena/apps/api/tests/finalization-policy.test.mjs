import test from 'node:test';
import assert from 'node:assert/strict';
import { ScoringService, invalidateViolationThresholdCache } from '../dist/services/scoring.js';

test('LOCK blocks direct submit and background finalization before scoring writes', async () => {
  const writes = [];
  const connection = {
    async beginTransaction() {}, async rollback() {}, release() {},
    async execute(sql) {
      if (sql.startsWith('SELECT id,status,expires_at')) return [[{ id: 1, status: 'TERMINATED', termination_action: 'LOCK', expired: 1 }]];
      if (sql.startsWith('SELECT question_count')) return [[]];
      if (sql.startsWith('SELECT state FROM exam_submissions')) return [[]];
      writes.push(sql); throw new Error('Unexpected scoring write');
    },
  };
  const scoring = new ScoringService({ getConnection: async () => connection });
  await assert.rejects(scoring.submit(1, 1, false), { statusCode: 409 });
  await assert.rejects(scoring.submit(1, 1, true), { statusCode: 409 });
  assert.deepEqual(writes, []);
});

test('threshold uses the same next count for database status and response', async () => {
  for (const threshold of [2, 3]) {
    for (let before = 0; before < threshold; before++) {
      invalidateViolationThresholdCache();
      let saved;
      const connection = {
        async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
        async execute(sql, params) {
          if (sql.startsWith('SELECT id,status,violation_count')) return [[{ id: 1, status: 'IN_PROGRESS', violation_count: before }]];
          if (sql.startsWith('SELECT key_name')) return [[{ key_name: 'violation_termination_threshold', value: String(threshold) }, { key_name: 'violation_action', value: 'LOCK' }]];
          if (sql.startsWith('INSERT IGNORE')) return [{ affectedRows: 1 }];
          if (sql.startsWith('UPDATE exam_attempts')) { saved = params; return [{ affectedRows: 1 }]; }
          throw new Error(sql);
        },
      };
      const result = await new ScoringService({ getConnection: async () => connection }).recordViolation(1, 1, 'violation-test-key', 'TAB_HIDDEN');
      assert.equal(result.count, before + 1);
      assert.equal(result.terminated, before + 1 === threshold);
      assert.equal(saved[0], result.count);
      assert.equal(saved[1], result.terminated);
      assert.equal(saved[3], 'LOCK');
    }
  }
});

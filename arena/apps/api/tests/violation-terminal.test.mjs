import assert from 'node:assert/strict';
import test from 'node:test';
import { ScoringService } from '../dist/services/scoring.js';

test('pelanggaran tidak ditambahkan sesudah attempt selesai', async () => {
  const statements = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT id,status,violation_count FROM exam_attempts'))
        return [[{ id: 1, status: 'COMPLETED', violation_count: 2 }]];
      throw new Error(`SQL tak terduga: ${sql}`);
    },
  };
  const scoring = new ScoringService({ getConnection: async () => connection });
  const result = await scoring.recordViolation(10, 20, 'event-key-123', 'TAB_HIDDEN');
  assert.deepEqual(result, { recorded: false, count: 2, terminated: false });
  assert.equal(statements.length, 1);
});

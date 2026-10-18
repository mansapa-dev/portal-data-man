import assert from 'node:assert/strict';
import test from 'node:test';
import { ScoringService } from '../dist/services/scoring.js';

function serviceFor(type) {
  const statements = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, params = []) {
      statements.push({ sql, params });
      if (sql.startsWith('SELECT id,status,violation_count')) return [[{ id: 1, status: 'IN_PROGRESS', violation_count: 0 }]];
      if (sql.startsWith('INSERT IGNORE INTO violations')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    },
  };
  return { service: new ScoringService({ getConnection: async () => connection }), statements, type };
}

test('sinyal dengan keyakinan rendah dicatat tanpa menaikkan hitungan terminasi', async () => {
  const { service, statements } = serviceFor('SPLIT_SCREEN_SUSPECTED');
  const result = await service.recordViolation(4, 9, 'event-key-123', 'SPLIT_SCREEN_SUSPECTED', { ip: '127.0.0.1', userAgent: 'test-browser', clientOccurredAt: '2026-10-18T01:02:03.000Z' });
  assert.deepEqual(result, { recorded: true, count: 0, terminated: false });
  assert.ok(statements.some((statement) => statement.sql.includes('client_occurred_at,ip_address,user_agent')));
  assert.ok(!statements.some((statement) => statement.sql.startsWith('UPDATE exam_attempts')));
});

test('sinyal pelanggaran utama tetap menaikkan hitungan server', async () => {
  const { service, statements } = serviceFor('TAB_HIDDEN');
  const result = await service.recordViolation(4, 9, 'event-key-456', 'TAB_HIDDEN');
  assert.deepEqual(result, { recorded: true, count: 1, terminated: false });
  assert.ok(statements.some((statement) => statement.sql.startsWith('UPDATE exam_attempts')));
});

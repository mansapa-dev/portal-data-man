import assert from 'node:assert/strict';
import test from 'node:test';
import { ScoringService, invalidateViolationThresholdCache } from '../dist/services/scoring.js';

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

test('sinyal pembagi layar keras kini dihitung menuju terminasi', async () => {
  const { service, statements } = serviceFor('SPLIT_SCREEN_SUSPECTED');
  const result = await service.recordViolation(4, 9, 'event-key-123', 'SPLIT_SCREEN_SUSPECTED', { ip: '127.0.0.1', userAgent: 'test-browser', clientOccurredAt: '2026-10-18T01:02:03.000Z' });
  assert.deepEqual(result, { recorded: true, count: 1, threshold: 3, action: 'AUTO_SUBMIT', terminated: false });
  assert.ok(statements.some((statement) => statement.sql.includes('client_occurred_at,ip_address,user_agent')));
  assert.ok(statements.some((statement) => statement.sql.startsWith('UPDATE exam_attempts')));
});

test('MULTI_TAB (tab ujian kedua pada perangkat yang sama) tetap menaikkan hitungan', async () => {
  const { service, statements } = serviceFor('MULTI_TAB');
  const result = await service.recordViolation(4, 9, 'event-key-789', 'MULTI_TAB', { ip: '127.0.0.1', userAgent: 'test-browser', clientOccurredAt: '2026-10-18T01:02:03.000Z' });
  assert.deepEqual(result, { recorded: true, count: 1, threshold: 3, action: 'AUTO_SUBMIT', terminated: false });
  assert.ok(statements.some((statement) => statement.sql.startsWith('UPDATE exam_attempts')));
});

test('sinyal pelanggaran utama tetap menaikkan hitungan server', async () => {
  const { service, statements } = serviceFor('TAB_HIDDEN');
  const result = await service.recordViolation(4, 9, 'event-key-456', 'TAB_HIDDEN');
  assert.deepEqual(result, { recorded: true, count: 1, threshold: 3, action: 'AUTO_SUBMIT', terminated: false });
  assert.ok(statements.some((statement) => statement.sql.startsWith('UPDATE exam_attempts')));
});

function rollupServiceFor(type, settingsRows = [{ key_name: 'violation_termination_threshold', value: '3' }], startCount = 0) {
  const statements = [];
  let rollupPending = 3; // COUNT termasuk baris yang baru di-INSERT (2 sebelumnya + 1)
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, params = []) {
      statements.push({ sql, params });
      if (sql.startsWith('SELECT id,status,violation_count')) return [[{ id: 1, status: 'IN_PROGRESS', violation_count: startCount }]];
      if (sql.startsWith('SELECT key_name,value FROM cbt_settings')) return [settingsRows];
      if (sql.startsWith('INSERT IGNORE INTO violations')) return [{ affectedRows: 1 }];
      if (sql.startsWith('SELECT COUNT(*) pending')) return [[{ pending: rollupPending }]];
      if (sql.startsWith('UPDATE violations SET rolled_up=1')) { rollupPending = 0; return [{ affectedRows: 3 }]; }
      return [{ affectedRows: 1 }];
    },
  };
  return { service: new ScoringService({ getConnection: async () => connection }), statements };
}

test('tiga kejadian sama-sama kelas (TEXT_SELECTION) di-roll-up jadi satu pelanggaran terhitung', async () => {
  const { service, statements } = rollupServiceFor('TEXT_SELECTION');
  const result = await service.recordViolation(4, 9, 'event-key-901', 'TEXT_SELECTION', { ip: '127.0.0.1', userAgent: 'test-browser', questionNo: 7 });
  assert.equal(result.recorded, true);
  assert.equal(result.count, 1);
  assert.equal(result.terminated, false);
  assert.ok(statements.some((statement) => statement.sql.startsWith('SELECT COUNT(*) pending')));
  assert.ok(statements.some((statement) => statement.sql.startsWith('UPDATE violations SET rolled_up=1')));
});

test('kebijakan LOCK menghentikan sesi tanpa finalisasi hasil', async () => {
  invalidateViolationThresholdCache();
  // violation_count=1 + salah satu sinyal terhitung -> tepat pada threshold 2
  const { service, statements } = rollupServiceFor('SPLIT_SCREEN_SUSPECTED', [
    { key_name: 'violation_termination_threshold', value: '2' },
    { key_name: 'violation_action', value: 'LOCK' },
  ], 1);
  const result = await service.recordViolation(4, 9, 'event-key-902', 'SPLIT_SCREEN_SUSPECTED', { ip: '127.0.0.1', userAgent: 'test-browser' });
  assert.equal(result.terminated, true);
  assert.equal(result.action, 'LOCK');
  assert.equal(result.hasil, undefined);
  assert.ok(statements.some((statement) => statement.sql.startsWith('UPDATE exam_attempts')));
});

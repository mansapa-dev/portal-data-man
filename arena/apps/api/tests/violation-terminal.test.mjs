import assert from 'node:assert/strict';
import test from 'node:test';
import { ScoringService, invalidateViolationThresholdCache } from '../dist/services/scoring.js';

test('pelanggaran tidak ditambahkan sesudah attempt selesai', async () => {
  const statements = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT id,status,violation_count FROM exam_attempts'))
        return [[{ id: 1, status: 'COMPLETED', violation_count: 2 }]];
      if (sql.startsWith('SELECT key_name,value FROM cbt_settings')) return [[{ key_name: 'violation_termination_threshold', value: '3' }]];
      throw new Error(`SQL tak terduga: ${sql}`);
    },
  };
  const submitConnection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql) {
      if (sql.startsWith('SELECT id,status,expires_at'))
        return [[{ id: 1, status: 'COMPLETED', expired: 1 }]];
      if (sql.startsWith('SELECT question_count,correct_count,wrong_count,blank_count,earned_points,maximum_points,score'))
        return [[{ question_count: 5, correct_count: 3, wrong_count: 1, blank_count: 1, earned_points: '3.00', maximum_points: '5.00', score: '60.00' }]];
      if (sql.startsWith('SELECT m.type,e.grade')) return [[]];
      throw new Error(`SQL submit tak terduga: ${sql}`);
    },
  };
  let poolCalls = 0;
  const pool = { async getConnection() { return poolCalls++ === 0 ? connection : submitConnection; } };
  const scoring = new ScoringService(pool);
  const result = await scoring.recordViolation(10, 20, 'event-key-123', 'TAB_HIDDEN');
  assert.deepEqual(result, { recorded: false, count: 2, threshold: 3, action: 'AUTO_SUBMIT', terminated: false });
  assert.equal(statements.length, 2);
});

test('terminasi memakai threshold 2 ketika pengaturan admin diatur ke 2', async () => {
  invalidateViolationThresholdCache();
  const statements = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT id,status,violation_count FROM exam_attempts'))
        return [[{ id: 1, status: 'IN_PROGRESS', violation_count: 1 }]];
      if (sql.startsWith('SELECT key_name,value FROM cbt_settings')) return [[{ key_name: 'violation_termination_threshold', value: '2' }]];
      if (sql.startsWith('INSERT IGNORE INTO violations')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    },
  };
  const submitConnection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql) {
      if (sql.startsWith('SELECT id,status,expires_at'))
        return [[{ id: 1, status: 'COMPLETED', expired: 1 }]];
      if (sql.startsWith('SELECT question_count,correct_count,wrong_count,blank_count,earned_points,maximum_points,score'))
        return [[{ question_count: 5, correct_count: 3, wrong_count: 1, blank_count: 1, earned_points: '3.00', maximum_points: '5.00', score: '60.00' }]];
      if (sql.startsWith('SELECT m.type,e.grade')) return [[]];
      throw new Error(`SQL submit tak terduga: ${sql}`);
    },
  };
  let poolCalls = 0;
  const pool = { async getConnection() { return poolCalls++ === 0 ? connection : submitConnection; } };
  const scoring = new ScoringService(pool);
  const result = await scoring.recordViolation(10, 20, 'event-key-456', 'SPLIT_SCREEN_SUSPECTED');
  assert.equal(result.recorded, true);
  assert.equal(result.count, 2);
  assert.equal(result.threshold, 2);
  assert.equal(result.terminated, true);
  assert.equal(result.hasil?.nilai, 60);
  assert.ok(statements.some((statement) => typeof statement === 'string' && statement.startsWith('UPDATE exam_attempts')));
});

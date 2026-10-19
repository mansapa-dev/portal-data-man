/**
 * connection-pool-safety.test.mjs
 *
 * Regression test for the recordViolation connection pool exhaustion bug:
 * Before the fix, recordViolation held its pool connection while calling
 * this.submit(), which also acquires a connection. In a small pool (e.g. 10
 * connections) with concurrent termination events this could deadlock.
 *
 * After the fix, the connection is released before submit() runs.
 *
 * This test verifies:
 * 1. submit() is called after the recordViolation connection is released.
 * 2. The total connection acquisition count is exactly 2 (one per operation).
 * 3. All connections are released at the end.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ScoringService } from '../dist/services/scoring.js';

test('recordViolation libera koneksi sebelum memanggil submit (anti-pool-exhaustion)', async () => {
  const releaseOrder = [];
  let connectionIndex = 0;

  // Connection 0: used by recordViolation
  const violationConn = {
    released: false,
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() { this.released = true; releaseOrder.push('violation-conn'); },
    async execute(sql) {
      // Attempt SELECT FOR UPDATE used by recordViolation
      if (sql.startsWith('SELECT id,status,violation_count FROM exam_attempts')) {
        // violation_count=2; next TAB_HIDDEN → count=3 → terminated
        return [[{ id: 1, status: 'IN_PROGRESS', violation_count: 2 }]];
      }
      if (sql.startsWith('INSERT IGNORE INTO violations')) return [{ affectedRows: 1 }];
      if (sql.startsWith('UPDATE exam_attempts SET violation_count')) return [{ affectedRows: 1 }];
      throw new Error(`Violation-conn unexpected SQL: ${sql}`);
    },
  };

  // Connection 1: used by submit (which runs after recordViolation releases)
  const submitConn = {
    released: false,
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() { this.released = true; releaseOrder.push('submit-conn'); },
    async execute(sql) {
      // submit acquires its own connection and runs: attempt + results check
      if (sql.startsWith('SELECT id,status,expires_at')) {
        // Already COMPLETED (re-entrant scenario — existing result found)
        return [[{ id: 1, status: 'COMPLETED', expired: 1 }]];
      }
      if (sql.startsWith('SELECT question_count,correct_count')) {
        return [[{
          question_count: 5, correct_count: 3, wrong_count: 1, blank_count: 1,
          earned_points: '3.00', maximum_points: '5.00', score: '60.00',
        }]];
      }
      if (sql.startsWith('SELECT m.type,e.grade')) return [[]];
      if (sql.startsWith('UPDATE exam_attempts SET status=IF(expires_at')) return [{ affectedRows: 1 }];
      throw new Error(`Submit-conn unexpected SQL: ${sql}`);
    },
  };

  const conns = [violationConn, submitConn];
  const pool = {
    getConnectionCallCount: 0,
    async getConnection() {
      this.getConnectionCallCount++;
      const conn = conns[connectionIndex++];
      if (!conn) throw new Error(`No mock connection available (index ${connectionIndex - 1})`);
      return conn;
    },
  };

  const scoring = new ScoringService(pool);

  // violation_count=2 + 1 counted TAB_HIDDEN → count=3 → terminated=true → submit is called
  const result = await scoring.recordViolation(9, 3, 'test-event-key-001', 'TAB_HIDDEN');

  assert.equal(result.terminated, true, 'Pelanggaran ke-3 harus menyebabkan terminasi');
  assert.ok(result.hasil, 'submit harus menghasilkan hasil');

  // Exactly 2 connections were acquired (recordViolation + submit)
  assert.equal(pool.getConnectionCallCount, 2, 'Harus tepat 2 koneksi yang diambil dari pool');

  // Both connections must be released
  assert.equal(violationConn.released, true, 'Koneksi recordViolation harus dilepas');
  assert.equal(submitConn.released, true, 'Koneksi submit harus dilepas');

  // The violation connection must be released BEFORE submit acquires its connection.
  // releaseOrder will show 'violation-conn' before 'submit-conn' only if the fix is in place.
  const violationReleaseIndex = releaseOrder.indexOf('violation-conn');
  assert.ok(violationReleaseIndex >= 0, 'violation-conn harus tercatat di releaseOrder');

  // submit-conn is released after submit finishes, so it appears later in releaseOrder.
  // Critically: violation-conn must appear before submit-conn (proves early release).
  const submitReleaseIndex = releaseOrder.indexOf('submit-conn');
  assert.ok(
    submitReleaseIndex > violationReleaseIndex,
    `violation-conn (pos ${violationReleaseIndex}) harus dilepas sebelum submit-conn (pos ${submitReleaseIndex}) — ` +
    `urutan: ${releaseOrder.join(' → ')}`,
  );
});

test('recordViolation melepas koneksi dengan benar saat tidak ada terminasi', async () => {
  let released = false;
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() { released = true; },
    async execute(sql) {
      if (sql.startsWith('SELECT id,status,violation_count')) {
        return [[{ id: 1, status: 'IN_PROGRESS', violation_count: 0 }]];
      }
      if (sql.startsWith('INSERT IGNORE INTO violations')) return [{ affectedRows: 1 }];
      if (sql.startsWith('UPDATE exam_attempts SET violation_count')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const pool = { async getConnection() { return conn; } };
  const scoring = new ScoringService(pool);

  // violation_count=0 + 1 TAB_HIDDEN → count=1 → not terminated
  const result = await scoring.recordViolation(9, 3, 'test-event-key-002', 'TAB_HIDDEN');
  assert.equal(result.terminated, false);
  assert.equal(released, true, 'Koneksi harus dilepas meskipun tidak ada terminasi');
});

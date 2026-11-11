import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptSubmission,
  claimSubmission,
  renewLease,
  completeSubmission,
  skipSubmission,
  DEFERRED_CODE,
  deferredError,
  isDeferredError,
} from '../dist/services/exam-submission.js';

/**
 * Fake pool/connection dengan routing SQL berbasis prefix (gaya
 * scoring-idempotency.test.mjs). SELECT dikembalikan sebagai [rows],
 * UPDATE/DELETE sebagai [{ affectedRows }] — meniru bentuk hasil
 * mysql2 execute() yang dipakai service.
 */
function makePool(routes, { record = () => {} } = {}) {
  const log = [];
  const run = (sql) => {
    for (const [prefix, handler] of routes) {
      if (sql.startsWith(prefix)) {
        record(sql);
        return handler(sql);
      }
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const connection = {
    async beginTransaction() { log.push('BEGIN'); },
    async commit() { log.push('COMMIT'); },
    async rollback() { log.push('ROLLBACK'); },
    release() {},
    async execute(sql) { return run(sql); },
  };
  const pool = {
    async getConnection() { return connection; },
    async execute(sql) { return run(sql); },
  };
  return { pool, log };
}

const attemptRow = (overrides = {}) => ({ id: 41, status: 'IN_PROGRESS', expires_at: '2026-01-01 00:00:00', termination_action: null, expired: 0, ...overrides });

test('acceptSubmission: attempt aktif valid → accepted, freeze + INSERT + COMMIT', async () => {
  const written = [];
  const { pool, log } = makePool([
    ['SELECT id,status,expires_at,termination_action', () => [[attemptRow()]]],
    ['SELECT 1 existing FROM exam_results', () => [[]]],
    ['UPDATE exam_attempts SET submitted_at', () => { written.push('freeze'); return [{ affectedRows: 1 }]; }],
    ['INSERT INTO exam_submissions', () => { written.push('insert'); return [{ affectedRows: 1 }]; }],
  ]);

  const outcome = await acceptSubmission(pool, 9, 3);

  assert.deepEqual(outcome, { kind: 'accepted' });
  assert.deepEqual(written, ['freeze', 'insert']);
  assert.equal(log.filter((e) => e === 'COMMIT').length, 1);
  assert.equal(log.filter((e) => e === 'ROLLBACK').length, 0);
});

test('acceptSubmission: attempt tidak ditemukan → 404 + ROLLBACK', async () => {
  const { pool, log } = makePool([
    ['SELECT id,status,expires_at,termination_action', () => [[]]],
  ]);

  await assert.rejects(acceptSubmission(pool, 9, 3), (error) => error.statusCode === 404);
  assert.ok(log.filter((e) => e === 'ROLLBACK').length >= 1);
});

test('acceptSubmission: attempt TERMINATED+LOCK → 409 tanpa submission', async () => {
  let inserted = false;
  const { pool } = makePool([
    ['SELECT id,status,expires_at,termination_action', () => [[attemptRow({ status: 'TERMINATED', termination_action: 'LOCK' })]]],
    ['SELECT 1 existing FROM exam_results', () => [[]]],
    ['INSERT INTO exam_submissions', () => { inserted = true; return [{ affectedRows: 1 }]; }],
  ]);

  await assert.rejects(acceptSubmission(pool, 9, 3), (error) => error.statusCode === 409);
  assert.equal(inserted, false);
});

test('acceptSubmission: finalizeOnly saat ujian masih aktif → 409', async () => {
  const { pool } = makePool([
    ['SELECT id,status,expires_at,termination_action', () => [[attemptRow()]]],
    ['SELECT 1 existing FROM exam_results', () => [[]]],
  ]);

  await assert.rejects(acceptSubmission(pool, 9, 3, { finalizeOnly: true }), (error) => error.statusCode === 409);
});

test('acceptSubmission: status bukan IN_PROGRESS/TERMINATED → 409', async () => {
  const { pool } = makePool([
    ['SELECT id,status,expires_at,termination_action', () => [[attemptRow({ status: 'COMPLETED', expired: 1 })]]],
    ['SELECT 1 existing FROM exam_results', () => [[]]],
  ]);

  await assert.rejects(acceptSubmission(pool, 9, 3), (error) => error.statusCode === 409);
});

test('acceptSubmission: fast-path exam_results ada → result-exists tanpa INSERT/freeze', async () => {
  const written = [];
  const { pool } = makePool([
    ['SELECT id,status,expires_at,termination_action', () => [[attemptRow()]]],
    ['SELECT 1 existing FROM exam_results', () => [[{ existing: 1 }]]],
    ['UPDATE exam_attempts SET submitted_at', () => { written.push('freeze'); return [{ affectedRows: 1 }]; }],
    ['INSERT INTO exam_submissions', () => { written.push('insert'); return [{ affectedRows: 1 }]; }],
  ]);

  const outcome = await acceptSubmission(pool, 9, 3);

  assert.deepEqual(outcome, { kind: 'result-exists' });
  assert.deepEqual(written, []);
});

test('acceptSubmission: ER_DUP_ENTRY dengan state RECEIVED → processing', async () => {
  const { pool, log } = makePool([
    ['SELECT id,status,expires_at,termination_action', () => [[attemptRow()]]],
    ['SELECT 1 existing FROM exam_results', () => [[]]],
    ['UPDATE exam_attempts SET submitted_at', () => [{ affectedRows: 1 }]],
    ['INSERT INTO exam_submissions', () => { const e = new Error('Duplicate'); e.code = 'ER_DUP_ENTRY'; throw e; }],
    ['SELECT student_id,exam_id,state,skip_reason', () => [[{ student_id: 9, exam_id: 3, state: 'RECEIVED', skip_reason: null }]]],
  ]);

  const outcome = await acceptSubmission(pool, 9, 3);

  assert.deepEqual(outcome, { kind: 'processing', state: 'RECEIVED' });
  assert.equal(log.filter((e) => e === 'COMMIT').length, 1);
});

test('acceptSubmission: duplikat state DONE → done', async () => {
  const { pool } = makePool([
    ['SELECT id,status,expires_at,termination_action', () => [[attemptRow()]]],
    ['SELECT 1 existing FROM exam_results', () => [[]]],
    ['UPDATE exam_attempts SET submitted_at', () => [{ affectedRows: 1 }]],
    ['INSERT INTO exam_submissions', () => { const e = new Error('Duplicate'); e.code = 'ER_DUP_ENTRY'; throw e; }],
    ['SELECT student_id,exam_id,state,skip_reason', () => [[{ student_id: 9, exam_id: 3, state: 'DONE', skip_reason: null }]]],
  ]);

  assert.deepEqual(await acceptSubmission(pool, 9, 3), { kind: 'done' });
});

test('acceptSubmission: duplikat state SKIPPED → skipped dengan reason', async () => {
  const { pool } = makePool([
    ['SELECT id,status,expires_at,termination_action', () => [[attemptRow({ status: 'TERMINATED' })]]],
    ['SELECT 1 existing FROM exam_results', () => [[]]],
    ['UPDATE exam_attempts SET submitted_at', () => [{ affectedRows: 1 }]],
    ['INSERT INTO exam_submissions', () => { const e = new Error('Duplicate'); e.code = 'ER_DUP_ENTRY'; throw e; }],
    ['SELECT student_id,exam_id,state,skip_reason', () => [[{ student_id: 9, exam_id: 3, state: 'SKIPPED', skip_reason: 'snapshot_missing' }]]],
  ]);

  assert.deepEqual(await acceptSubmission(pool, 9, 3), { kind: 'skipped', reason: 'snapshot_missing' });
});

test('acceptSubmission: duplikat milik sesi lain → 500', async () => {
  const { pool } = makePool([
    ['SELECT id,status,expires_at,termination_action', () => [[attemptRow()]]],
    ['SELECT 1 existing FROM exam_results', () => [[]]],
    ['UPDATE exam_attempts SET submitted_at', () => [{ affectedRows: 1 }]],
    ['INSERT INTO exam_submissions', () => { const e = new Error('Duplicate'); e.code = 'ER_DUP_ENTRY'; throw e; }],
    ['SELECT student_id,exam_id,state,skip_reason', () => [[{ student_id: 77, exam_id: 3, state: 'RECEIVED', skip_reason: null }]]],
  ]);

  await assert.rejects(acceptSubmission(pool, 9, 3), (error) => error.statusCode === 500);
});

test('claimSubmission: RECEIVED + cap belum tercapai → claimed dengan token & accepted_*', async () => {
  const { pool } = makePool([
    ['SELECT id FROM exam_attempts WHERE student_id', () => [[{ id: 41 }]]],
    ['SELECT state,skip_reason FROM exam_submissions', () => [[{ state: 'RECEIVED', skip_reason: null }]]],
    ['SELECT COUNT(*) n FROM exam_results', () => [[{ n: 0 }]]],
    ['UPDATE exam_submissions SET state=', () => [{ affectedRows: 1 }]],
    ['UPDATE exam_attempts SET submitted_at=COALESCE', () => [{ affectedRows: 1 }]],
    ['SELECT accepted_status,accepted_expired', () => [[{ accepted_status: 'TERMINATED', accepted_expired: 1 }]]],
  ]);

  const outcome = await claimSubmission(pool, 9, 3, { maxAttempts: 5, leaseMs: 60000 });

  assert.equal(outcome.kind, 'claimed');
  assert.equal(outcome.attemptId, 41);
  assert.match(outcome.token, /^[0-9a-f]{32}$/);
  assert.equal(outcome.acceptedExpired, true);
  assert.equal(outcome.acceptedStatus, 'TERMINATED');
  assert.equal(outcome.hadResults, false);
  assert.equal(outcome.leaseMs, 60000);
});

test('claimSubmission: tanpa baris submission → legacy (finalisasi lama boleh jalan)', async () => {
  const { pool } = makePool([
    ['SELECT id FROM exam_attempts WHERE student_id', () => [[{ id: 41 }]]],
    ['SELECT state,skip_reason FROM exam_submissions', () => [[]]],
    ['SELECT COUNT(*) n FROM exam_results', () => [[{ n: 1 }]]],
  ]);

  const outcome = await claimSubmission(pool, 9, 3, {});

  assert.deepEqual(outcome, { kind: 'legacy', attemptId: 41, hadResults: true });
});

test('claimSubmission: attempt tidak ada → legacy attemptId 0', async () => {
  const { pool } = makePool([
    ['SELECT id FROM exam_attempts WHERE student_id', () => [[]]],
  ]);

  const outcome = await claimSubmission(pool, 9, 3, {});

  assert.deepEqual(outcome, { kind: 'legacy', attemptId: 0, hadResults: false });
});

test('claimSubmission: state DONE/SKIPPED → skipped tanpa klaim ulang', async () => {
  const claimed = [];
  const { pool } = makePool([
    ['SELECT id FROM exam_attempts WHERE student_id', () => [[{ id: 41 }]]],
    ['SELECT state,skip_reason FROM exam_submissions', () => [[{ state: 'SKIPPED', skip_reason: 'lease_exhausted' }]]],
    ['SELECT COUNT(*) n FROM exam_results', () => [[{ n: 0 }]]],
    ['UPDATE exam_submissions SET state=', () => { claimed.push(1); return [{ affectedRows: 1 }]; }],
  ]);

  const outcome = await claimSubmission(pool, 9, 3, {});

  assert.deepEqual(outcome, { kind: 'skipped', reason: 'lease_exhausted' });
  assert.equal(claimed.length, 0);
});

test('claimSubmission: predikat cap gagal + SKIPPED berhasil → skipped lease_exhausted', async () => {
  const { pool } = makePool([
    ['SELECT id FROM exam_attempts WHERE student_id', () => [[{ id: 41 }]]],
    ['SELECT state,skip_reason FROM exam_submissions', () => [[{ state: 'RECEIVED', skip_reason: null }]]],
    ['SELECT COUNT(*) n FROM exam_results', () => [[{ n: 0 }]]],
    ["UPDATE exam_submissions SET state='PROCESSING'", () => [{ affectedRows: 0 }]],
    ["UPDATE exam_submissions SET state='SKIPPED', skip_reason='lease_exhausted'", () => [{ affectedRows: 1 }]],
  ]);

  const outcome = await claimSubmission(pool, 9, 3, { maxAttempts: 5, leaseMs: 60000 });

  assert.deepEqual(outcome, { kind: 'skipped', reason: 'lease_exhausted' });
});

test('claimSubmission: predikat gagal dan baris dimiliki worker lain → busy', async () => {
  const { pool } = makePool([
    ['SELECT id FROM exam_attempts WHERE student_id', () => [[{ id: 41 }]]],
    ['SELECT state,skip_reason FROM exam_submissions', () => [[{ state: 'PROCESSING', skip_reason: null }]]],
    ['SELECT COUNT(*) n FROM exam_results', () => [[{ n: 0 }]]],
    ["UPDATE exam_submissions SET state='PROCESSING'", () => [{ affectedRows: 0 }]],
    ["UPDATE exam_submissions SET state='SKIPPED', skip_reason='lease_exhausted'", () => [{ affectedRows: 0 }]],
  ]);

  const outcome = await claimSubmission(pool, 9, 3, { maxAttempts: 5, leaseMs: 60000 });

  assert.deepEqual(outcome, { kind: 'busy' });
});

test('renewLease: token pemilik → true; token lain → false', async () => {
  const owner = makePool([
    ["UPDATE exam_submissions SET lease_expires_at", () => [{ affectedRows: 1 }]],
  ]);
  const foreign = makePool([
    ["UPDATE exam_submissions SET lease_expires_at", () => [{ affectedRows: 0 }]],
  ]);

  assert.equal(await renewLease(owner.pool, 41, 'a'.repeat(32), 60000), true);
  assert.equal(await renewLease(foreign.pool, 41, 'b'.repeat(32), 60000), false);
});

test('completeSubmission: token cocok + PROCESSING → done', async () => {
  const { pool } = makePool([
    ['SELECT id FROM exam_attempts WHERE id', () => [[{ id: 41 }]]],
    ['SELECT state,claim_token FROM exam_submissions', () => [[{ state: 'PROCESSING', claim_token: 'tok' }]]],
    ["UPDATE exam_submissions SET state='DONE'", () => [{ affectedRows: 1 }]],
  ]);

  assert.equal(await completeSubmission(pool, 41, 'tok'), 'done');
});

test('completeSubmission: token lama setelah takeover → taken_over tanpa menulis state', async () => {
  const written = [];
  const { pool } = makePool([
    ['SELECT id FROM exam_attempts WHERE id', () => [[{ id: 41 }]]],
    ['SELECT state,claim_token FROM exam_submissions', () => [[{ state: 'PROCESSING', claim_token: 'new-owner-token' }]]],
    ["UPDATE exam_submissions SET state='DONE'", () => { written.push('done'); return [{ affectedRows: 1 }]; }],
  ]);

  const outcome = await completeSubmission(pool, 41, 'stale-token');

  assert.equal(outcome, 'taken_over');
  assert.deepEqual(written, []);
});

test('completeSubmission: submission hilang (admin reset) + tidak ada hasil saat claim → revert', async () => {
  const written = [];
  const { pool } = makePool([
    ['SELECT id FROM exam_attempts WHERE id', () => [[{ id: 41 }]]],
    ['SELECT state,claim_token FROM exam_submissions', () => [[]]],
    ['DELETE FROM exam_results', () => { written.push('delete-results'); return [{ affectedRows: 2 }]; }],
    ["UPDATE exam_attempts SET status='IN_PROGRESS'", () => { written.push('restore'); return [{ affectedRows: 1 }]; }],
  ]);

  const outcome = await completeSubmission(pool, 41, 'tok', { claimedHadResults: false });

  assert.equal(outcome, 'reset_detected');
  assert.deepEqual(written, ['delete-results', 'restore']);
});

test('completeSubmission: submission hilang tapi hasil sudah ada saat claim → taken_over (tidak menghapus hasil lama)', async () => {
  const written = [];
  const { pool } = makePool([
    ['SELECT id FROM exam_attempts WHERE id', () => [[{ id: 41 }]]],
    ['SELECT state,claim_token FROM exam_submissions', () => [[]]],
    ['DELETE FROM exam_results', () => { written.push('delete-results'); return [{ affectedRows: 1 }]; }],
  ]);

  const outcome = await completeSubmission(pool, 41, 'tok', { claimedHadResults: true });

  assert.equal(outcome, 'taken_over');
  assert.deepEqual(written, []);
});

test('skipSubmission: token pemilik → skipped; token lama → taken_over/reset_detected', async () => {
  const owner = makePool([
    ['SELECT id FROM exam_attempts WHERE id', () => [[{ id: 41 }]]],
    ["UPDATE exam_submissions SET state='SKIPPED', skip_reason=?", () => [{ affectedRows: 1 }]],
  ]);
  assert.equal(await skipSubmission(owner.pool, 41, 'tok', 'snapshot_missing'), 'skipped');

  const taken = makePool([
    ['SELECT id FROM exam_attempts WHERE id', () => [[{ id: 41 }]]],
    ["UPDATE exam_submissions SET state='SKIPPED', skip_reason=?", () => [{ affectedRows: 0 }]],
    ['SELECT 1 existing FROM exam_submissions', () => [[{ existing: 1 }]]],
  ]);
  assert.equal(await skipSubmission(taken.pool, 41, 'stale', 'snapshot_missing'), 'taken_over');

  const reset = makePool([
    ['SELECT id FROM exam_attempts WHERE id', () => [[{ id: 41 }]]],
    ["UPDATE exam_submissions SET state='SKIPPED', skip_reason=?", () => [{ affectedRows: 0 }]],
    ['SELECT 1 existing FROM exam_submissions', () => [[]]],
  ]);
  assert.equal(await skipSubmission(reset.pool, 41, 'stale', 'snapshot_missing'), 'reset_detected');
});

test('DEFERRED error helper: kode + statusCode 409', () => {
  const error = deferredError();
  assert.equal(error.code, DEFERRED_CODE);
  assert.equal(error.statusCode, 409);
  assert.equal(isDeferredError(error), true);
  assert.equal(isDeferredError(new Error('x')), false);
  assert.equal(isDeferredError(null), false);
});

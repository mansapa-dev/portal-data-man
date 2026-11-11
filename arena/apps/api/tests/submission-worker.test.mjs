import assert from 'node:assert/strict';
import test from 'node:test';
import { executeSubmissionFinalization } from '../dist/services/finalization-queue.js';
import { selfHealDoneWithoutResults, scanPendingSubmissions } from '../dist/services/expired-attempt-finalizer.js';
import { DEFERRED_CODE } from '../dist/services/exam-submission.js';

/**
 * Fake pool stateful untuk alur worker: satu baris submission + attempt,
 * dengan state yang bisa dimutasi antar langkah (untuk simulasi crash/takeover).
 */
function makeStatefulPool(initial = {}) {
  const state = {
    attempt: initial.attempt ?? { id: 41, status: 'IN_PROGRESS', expires_at: '2026-01-01 00:00:00', termination_action: null, expired: 0 },
    submission: initial.submission ?? null, // null = belum ada submission
    results: initial.results ?? 0,
    token: null,
    leaseExpiresAt: null,
    leaseAttempts: 0,
    executed: [],
  };
  const executed = state.executed;
  const connection = {
    async beginTransaction() { executed.push('BEGIN'); },
    async commit() { executed.push('COMMIT'); },
    async rollback() { executed.push('ROLLBACK'); },
    release() {},
    async execute(sql, params = []) {
      if (sql.startsWith('SELECT id FROM exam_attempts WHERE student_id')) return [[state.attempt]];
      if (sql.startsWith('SELECT id FROM exam_attempts WHERE id')) return [[state.attempt]];
      if (sql.startsWith('SELECT state,claim_token FROM exam_submissions')) {
        return state.submission ? [[{ state: state.submission.state, claim_token: state.submission.claim_token ?? null }]] : [[]];
      }
      if (sql.startsWith('SELECT state,skip_reason FROM exam_submissions')) {
        return state.submission ? [[{ state: state.submission.state, skip_reason: state.submission.skip_reason ?? null }]] : [[]];
      }
      if (sql.startsWith('SELECT COUNT(*) n FROM exam_results')) return [[{ n: state.results }]];
      if (sql.startsWith("UPDATE exam_submissions SET state='PROCESSING'")) {
        const canClaim = state.submission
          && (state.submission.state === 'RECEIVED' || (state.submission.state === 'PROCESSING' && state.leaseExpiresAt !== null && state.leaseExpiresAt < Date.now()))
          && state.leaseAttempts < (params[3] ?? 5);
        if (!canClaim) return [{ affectedRows: 0 }];
        state.token = params[0];
        state.leaseAttempts += 1;
        state.leaseExpiresAt = Date.now() + 60_000;
        state.submission = { ...state.submission, state: 'PROCESSING', claim_token: params[0] };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE exam_submissions SET state='SKIPPED', skip_reason='lease_exhausted'")) {
        if (!state.submission || state.leaseAttempts < (params[1] ?? 5)) return [{ affectedRows: 0 }];
        state.submission = { ...state.submission, state: 'SKIPPED', skip_reason: 'lease_exhausted' };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE exam_attempts SET submitted_at=COALESCE')) return [{ affectedRows: 1 }];
      if (sql.startsWith('SELECT accepted_status,accepted_expired')) {
        return [[{ accepted_status: state.submission?.accepted_status ?? 'IN_PROGRESS', accepted_expired: state.submission?.accepted_expired ?? 0 }]];
      }
      if (sql.startsWith("UPDATE exam_submissions SET state='DONE'")) {
        if (!state.submission || state.submission.claim_token !== params[1] || state.submission.state !== 'PROCESSING') return [{ affectedRows: 0 }];
        state.submission = { ...state.submission, state: 'DONE' };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE FROM exam_results')) {
        const deleted = state.results;
        state.results = 0;
        return [{ affectedRows: deleted }];
      }
      if (sql.startsWith("UPDATE exam_attempts SET status='IN_PROGRESS'")) {
        state.attempt = { ...state.attempt, status: 'IN_PROGRESS' };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE exam_submissions SET state='SKIPPED', skip_reason=?")) {
        if (!state.submission || state.submission.claim_token !== params[2] || state.submission.state !== 'PROCESSING') return [{ affectedRows: 0 }];
        state.submission = { ...state.submission, state: 'SKIPPED', skip_reason: params[0] };
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const pool = {
    async getConnection() { return connection; },
    async execute(sql, params = []) {
      if (sql.startsWith('UPDATE exam_submissions SET lease_expires_at=DATE_ADD')) {
        if (!state.submission || state.submission.claim_token !== params[1] || state.submission.state !== 'PROCESSING') return [{ affectedRows: 0 }];
        state.leaseExpiresAt = Date.now() + 60_000;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT 1 existing FROM exam_submissions')) return [[state.submission ? { existing: 1 } : {}]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async query() { return [[]]; },
  };
  return { pool, state, executed };
}

test('worker: submission RECEIVED → claim → scoring → DONE', async () => {
  const { pool, state } = makeStatefulPool({
    submission: { state: 'RECEIVED', accepted_status: 'IN_PROGRESS', accepted_expired: 0 },
  });
  const calls = [];
  const scoring = {
    async submit(studentId, examId, finalizeOnly, options) {
      calls.push({ studentId, examId, finalizeOnly, options });
      state.results = 1;
      return { status: 'selesai' };
    },
  };

  const result = await executeSubmissionFinalization(pool, scoring, 9, 3);

  assert.deepEqual(result, { status: 'selesai' });
  assert.equal(state.submission.state, 'DONE');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].finalizeOnly, false);
  assert.equal(calls[0].options.onBehalfOfSubmission, true);
  assert.equal(calls[0].options.statusOverride, 'COMPLETED');
});

test('worker: submission accepted setelah deadline → statusOverride EXPIRED', async () => {
  const { pool, state } = makeStatefulPool({
    submission: { state: 'RECEIVED', accepted_status: 'IN_PROGRESS', accepted_expired: 1 },
  });
  const calls = [];
  const scoring = { async submit(studentId, examId, finalizeOnly, options) { calls.push(options); state.results = 1; return { status: 'selesai' }; } };

  await executeSubmissionFinalization(pool, scoring, 9, 3);

  assert.equal(calls[0].statusOverride, 'EXPIRED');
});

test('worker: attempt TERMINATED → statusOverride null (TERMINATED dipertahankan)', async () => {
  const { pool, state } = makeStatefulPool({
    attempt: { id: 41, status: 'TERMINATED', expires_at: '2026-01-01 00:00:00', termination_action: 'AUTO_SUBMIT', expired: 0 },
    submission: { state: 'RECEIVED', accepted_status: 'TERMINATED', accepted_expired: 0 },
  });
  const calls = [];
  const scoring = { async submit(studentId, examId, finalizeOnly, options) { calls.push(options); state.results = 1; return { status: 'selesai' }; } };

  await executeSubmissionFinalization(pool, scoring, 9, 3);

  assert.equal(calls[0].statusOverride, null);
});

test('worker: tanpa baris submission → finalisasi legacy (tidak membuat submission)', async () => {
  const { pool, state } = makeStatefulPool({ submission: null });
  const calls = [];
  const scoring = { async submit(studentId, examId, finalizeOnly) { calls.push({ studentId, examId, finalizeOnly }); state.results = 1; return { status: 'selesai' }; } };

  const result = await executeSubmissionFinalization(pool, scoring, 9, 3);

  assert.deepEqual(result, { status: 'selesai' });
  assert.equal(calls[0].finalizeOnly, true);
  assert.equal(state.submission, null);
});

test('worker: legacy finalisasi ditolak DEFERRED → menyerah ke submission worker', async () => {
  const { pool } = makeStatefulPool({ submission: null });
  const scoring = {
    async submit() { throw Object.assign(new Error('ditunda'), { statusCode: 409, code: DEFERRED_CODE }); },
  };

  const result = await executeSubmissionFinalization(pool, scoring, 9, 3);

  assert.deepEqual(result, { deferred: true });
});

test('worker: submission dengan lease milik worker lain → busy (tidak menggandakan kerja)', async () => {
  const { pool } = makeStatefulPool({ submission: { state: 'PROCESSING', accepted_status: 'IN_PROGRESS', accepted_expired: 0 } });
  pool.getConnection = async () => {
    const base = await makeStatefulPool({ submission: { state: 'PROCESSING', accepted_status: 'IN_PROGRESS', accepted_expired: 0 } });
    base.state.leaseExpiresAt = Date.now() + 60_000; // lease valid → claim ditolak
    base.state.leaseAttempts = 1;
    return base.pool.getConnection();
  };
  const scoring = { async submit() { throw new Error('tidak boleh scoring'); } };

  const result = await executeSubmissionFinalization(pool, scoring, 9, 3);

  assert.deepEqual(result, { deferred: true });
});

test('worker: scoring 409 (snapshot hilang) → submission SKIPPED dengan reason', async () => {
  const { pool, state } = makeStatefulPool({
    submission: { state: 'RECEIVED', accepted_status: 'IN_PROGRESS', accepted_expired: 0 },
  });
  const scoring = { async submit() { throw Object.assign(new Error('Snapshot soal tidak tersedia'), { statusCode: 409 }); } };

  const result = await executeSubmissionFinalization(pool, scoring, 9, 3);

  assert.deepEqual(result, { skipped: true, reason: 'snapshot_missing' });
  assert.equal(state.submission.state, 'SKIPPED');
  assert.equal(state.submission.skip_reason, 'snapshot_missing');
});

test('worker: scoring 404 (attempt hilang) → SKIPPED attempt_missing', async () => {
  const { pool, state } = makeStatefulPool({
    submission: { state: 'RECEIVED', accepted_status: 'IN_PROGRESS', accepted_expired: 0 },
  });
  const scoring = { async submit() { throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 }); } };

  const result = await executeSubmissionFinalization(pool, scoring, 9, 3);

  assert.deepEqual(result, { skipped: true, reason: 'attempt_missing' });
  assert.equal(state.submission.state, 'SKIPPED');
});

test('worker: crash setelah scoring commit sebelum DONE → klaim ulang memakai idempotensi exam_results', async () => {
  // Worker pertama commit hasil lalu crash sebelum completeSubmission.
  const { pool, state } = makeStatefulPool({
    submission: { state: 'RECEIVED', accepted_status: 'IN_PROGRESS', accepted_expired: 0 },
  });
  let calls = 0;
  const scoring = {
    async submit() {
      calls++;
      if (calls === 1) {
        state.results = 1; // hasil sudah commit
        throw new Error('crash setelah commit');
      }
      return { status: 'selesai', reused: true }; // fast path: hasil sudah ada
    },
  };
  await assert.rejects(executeSubmissionFinalization(pool, scoring, 9, 3), /crash setelah commit/);
  assert.equal(state.submission.state, 'PROCESSING');
  // State masih PROCESSING; lease dianggap kedaluwarsa untuk takeover.
  state.leaseExpiresAt = Date.now() - 1000;

  // Worker kedua: claim takeover → scoring fast-path (hasil sudah ada) → DONE.
  const second = await executeSubmissionFinalization(pool, scoring, 9, 3);
  assert.deepEqual(second, { status: 'selesai', reused: true });
  assert.equal(state.submission.state, 'DONE');
  assert.equal(state.results, 1, 'tidak boleh ada hasil ganda');
});

test('worker: lease kedaluwarsa → takeover worker lain, token lama tidak berkuasa', async () => {
  const { pool, state } = makeStatefulPool({
    submission: { state: 'PROCESSING', accepted_status: 'IN_PROGRESS', accepted_expired: 0 },
  });
  state.leaseExpiresAt = Date.now() - 1000; // lease lama kedaluwarsa
  state.leaseAttempts = 1;
  const calls = [];
  const scoring = { async submit(studentId, examId, finalizeOnly, options) { calls.push(options); state.results = 1; return { status: 'selesai' }; } };

  const result = await executeSubmissionFinalization(pool, scoring, 9, 3);

  assert.deepEqual(result, { status: 'selesai' });
  assert.equal(state.submission.state, 'DONE');
  assert.equal(state.leaseAttempts, 2);
});

test('worker: cap percobaan habis → SKIPPED lease_exhausted, tidak terus diproses', async () => {
  const { pool, state } = makeStatefulPool({
    submission: { state: 'RECEIVED', accepted_status: 'IN_PROGRESS', accepted_expired: 0 },
  });
  state.leaseAttempts = 5; // cap default 5 sudah tercapai
  const scoring = { async submit() { throw new Error('tidak boleh scoring'); } };

  const result = await executeSubmissionFinalization(pool, scoring, 9, 3);

  assert.deepEqual(result, { skipped: true, reason: 'lease_exhausted' });
  assert.equal(state.submission.state, 'SKIPPED');
});

test('worker: migrasi 016 belum diterapkan (ER_NO_SUCH_TABLE) → fallback finalisasi legacy', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute() { const error = new Error("Table 'arena.exam_submissions' doesn't exist"); error.code = 'ER_NO_SUCH_TABLE'; throw error; },
  };
  const pool = { async getConnection() { return connection; } };
  const scoring = { async submit(studentId, examId, finalizeOnly) { calls.push({ studentId, examId, finalizeOnly }); return { status: 'selesai' }; } };

  const result = await executeSubmissionFinalization(pool, scoring, 9, 3);

  assert.deepEqual(result, { status: 'selesai' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].finalizeOnly, true, 'fallback memakai jalur legacy (finalizeOnly)');
});

test('reconciler: self-heal DONE tanpa exam_results → kembali RECEIVED', async () => {
  const executed = [];
  const pool = {
    async execute(sql, params = []) {
      executed.push({ sql, params });
      return [{ affectedRows: 2 }];
    },
  };

  const healed = await selfHealDoneWithoutResults(pool);

  assert.equal(healed, 2);
  assert.match(executed[0].sql, /state='DONE'/);
  assert.match(executed[0].sql, /NOT EXISTS \(SELECT 1 FROM exam_results/);
  assert.match(executed[0].sql, /state='RECEIVED'/);
});

test('reconciler: scan submission hanya RECEIVED dan PROCESSING lease-expired', async () => {
  let captured = '';
  const pool = {
    async query(sql) { captured = sql; return [[{ student_id: 1, exam_id: 2 }]]; },
  };

  const rows = await scanPendingSubmissions(pool, 100);

  assert.equal(rows.length, 1);
  assert.match(captured, /s\.state='RECEIVED'/);
  assert.match(captured, /s\.state='PROCESSING' AND s\.lease_expires_at < UTC_TIMESTAMP\(3\)/);
  assert.doesNotMatch(captured, /s\.state='SKIPPED'/);
  assert.doesNotMatch(captured, /s\.state='DONE'/);
});

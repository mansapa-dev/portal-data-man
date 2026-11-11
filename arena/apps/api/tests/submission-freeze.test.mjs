import assert from 'node:assert/strict';
import test from 'node:test';
import { ScoringService } from '../dist/services/scoring.js';
import { StudentExamService } from '../dist/services/student-exam.js';
import { resetTerminatedAttemptInTransaction } from '../dist/services/attempt-reset.js';
import { DEFERRED_CODE } from '../dist/services/exam-submission.js';

const claims = { sub: 9 };

/**
 * Fake pool dengan routing SQL berbasis prefix; UPDATE/DELETE mengembalikan
 * [{ affectedRows }] dan opsional mencatat params untuk assert.
 */
function makePool(routes) {
  const log = [];
  const run = (sql, params = []) => {
    for (const [prefix, handler] of routes) {
      if (sql.startsWith(prefix)) {
        log.push({ sql: sql.slice(0, 90), params });
        return handler(sql, params);
      }
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const connection = {
    log,
    async beginTransaction() { log.push({ sql: 'BEGIN' }); },
    async commit() { log.push({ sql: 'COMMIT' }); },
    async rollback() { log.push({ sql: 'ROLLBACK' }); },
    release() {},
    query(sql, params) { return run(sql, params); },
    async execute(sql, params) { return run(sql, params); },
  };
  return { pool: { async getConnection() { return connection; } }, connection, log };
}

// --- Freeze autosave jalur tunggal -------------------------------------

function unifiedRow(overrides = {}) {
  return {
    attempt_id: 41, public_id: 'ATTEMPT_PUBLIC_001', attempt_status: 'IN_PROGRESS',
    expires_at: '2026-01-01 00:00:00', expired: 0, submitted_at: null,
    question_type: 'MULTIPLE_CHOICE', option_a_available: 1, option_b_available: 1,
    option_c_available: 0, option_d_available: 0, option_e_available: 0,
    revision: 0, mutation_id: null, answer_id: null, answer: null, is_flagged: 0,
    ...overrides,
  };
}

test('autosave tunggal ditolak 409 setelah submitted_at ter-set (tanpa tulis)', async () => {
  const writes = [];
  const { pool, log } = makePool([
    ['SELECT ea.id AS attempt_id', () => [[unifiedRow({ submitted_at: '2026-01-01 00:00:01.000' })]]],
    ['UPDATE student_answers', () => { writes.push('answer'); return [{ affectedRows: 1 }]; }],
    ['UPDATE answer_write_versions', () => { writes.push('version'); return [{ affectedRows: 1 }]; }],
    ['INSERT INTO student_answers', () => { writes.push('insert-answer'); return [{ affectedRows: 1 }]; }],
    ['INSERT INTO answer_write_versions', () => { writes.push('insert-version'); return [{ affectedRows: 1 }]; }],
  ]);
  const service = new StudentExamService(pool);

  await assert.rejects(
    service.saveAnswer(claims, 3, 10, { answer: 'A', is_flagged: false, attempt_id: 'ATTEMPT_PUBLIC_001', base_revision: 0, mutation_id: 'mut-aaaaaaaaaaaaaaaa1' }),
    (error) => error.statusCode === 409,
  );

  assert.deepEqual(writes, []);
  assert.ok(log.some((entry) => entry.sql === 'ROLLBACK'));
});

test('autosave tunggal mutation duplikat setelah freeze tetap dijawab duplicate tanpa tulis', async () => {
  const writes = [];
  const { pool } = makePool([
    ['SELECT ea.id AS attempt_id', () => [[unifiedRow({ mutation_id: 'mut-aaaaaaaaaaaaaaaa1', answer: 'A', revision: 1 })]]],
    ['UPDATE student_answers', () => { writes.push('answer'); return [{ affectedRows: 1 }]; }],
  ]);
  const service = new StudentExamService(pool);

  const result = await service.saveAnswer(claims, 3, 10, { answer: 'A', is_flagged: false, attempt_id: 'ATTEMPT_PUBLIC_001', base_revision: 1, mutation_id: 'mut-aaaaaaaaaaaaaaaa1' });

  assert.deepEqual(result, { question_id: 10, revision: 1, duplicate: true });
  assert.deepEqual(writes, []);
});

// --- Freeze autosave jalur batch ---------------------------------------

const baseInput = { attempt_id: 'ATTEMPT_PUBLIC_001', answers: [] };

function batchPool(attemptOverrides = {}) {
  const writes = [];
  const routes = [
    ['SELECT id,public_id,status,expires_at', () => [[{ id: 41, public_id: 'ATTEMPT_PUBLIC_001', status: 'IN_PROGRESS', expires_at: '2026-01-01 00:00:00', expired: 0, submitted_at: null, ...attemptOverrides }]]],
    ['SELECT q.question_id,q.question_type', (sql, params) => [[{ question_id: Number(params[1]), question_type: 'MULTIPLE_CHOICE', option_a_available: 1, option_b_available: 1, option_c_available: 0, option_d_available: 0, option_e_available: 0, revision: 2, mutation_id: 'mut-bbbbbbbbbbbbbbbb1', answer: 'A', is_flagged: 0 }]]],
    ['INSERT INTO student_answers', () => { writes.push('insert-answer'); return [{ affectedRows: 1 }]; }],
    ['INSERT INTO answer_write_versions', () => { writes.push('insert-version'); return [{ affectedRows: 1 }]; }],
  ];
  const { pool, log } = makePool(routes);
  return { pool, writes, log };
}

test('autosave batch ditolak 409 setelah submitted_at ter-set (tanpa tulis)', async () => {
  const { pool, writes } = batchPool({ submitted_at: '2026-01-01 00:00:01.000' });
  const service = new StudentExamService(pool);

  await assert.rejects(
    service.saveAnswersBatch(claims, 3, { ...baseInput, answers: [{ question_id: 10, answer: 'A', is_flagged: false, base_revision: 2, mutation_id: 'mut-newwwwwwwwwwwwww1' }] }),
    (error) => error.statusCode === 409,
  );
  assert.deepEqual(writes, []);
});

test('autosave batch dengan seluruh item mutation duplikat tetap sukses tanpa tulis setelah freeze', async () => {
  const { pool, writes } = batchPool({ submitted_at: '2026-01-01 00:00:01.000' });
  const service = new StudentExamService(pool);

  const result = await service.saveAnswersBatch(claims, 3, { ...baseInput, answers: [{ question_id: 10, answer: 'A', is_flagged: false, base_revision: 2, mutation_id: 'mut-bbbbbbbbbbbbbbbb1' }] });

  assert.deepEqual(result, { revisions: { 10: 2 } });
  assert.deepEqual(writes, []);
});

// --- Submission-aware finalization --------------------------------------

function scoringRoutes({ submissionState, statusOverrideCapture = [], resultRows = [] }) {
  return [
    ['SELECT id,status,expires_at,termination_action', () => [[{ id: 41, status: 'IN_PROGRESS', expires_at: '2026-01-01 00:00:00', termination_action: null, expired: 1 }]]],
    ['SELECT question_count', () => [resultRows]],
    ['SELECT state FROM exam_submissions', () => [[submissionState ? { state: submissionState } : {}]]],
    ['SELECT m.type,e.grade', () => [[]]],
    ['SELECT q.question_id,q.question_type', () => [[{ question_id: 1, question_type: 'MULTIPLE_CHOICE', correct_answer: 'A', points: '1.00', answer: 'A', option_count: 4 }]]],
    ['INSERT INTO exam_results', () => [{ affectedRows: 1 }]],
    ["UPDATE exam_attempts SET status=IF(status='TERMINATED'", (sql, params) => { statusOverrideCapture.push(params); return [{ affectedRows: 1 }]; }],
  ];
}

test('finalisasi legacy menyerah dengan SUBMISSION_DEFERRED 409 saat submission RECEIVED', async () => {
  const statusOverrideCapture = [];
  const { pool } = makePool(scoringRoutes({ submissionState: 'RECEIVED', statusOverrideCapture }));
  const scoring = new ScoringService(pool);

  await assert.rejects(scoring.submit(9, 3, true), (error) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, DEFERRED_CODE);
    return true;
  });
  assert.deepEqual(statusOverrideCapture, []);
});

test('finalisasi legacy juga menyerah saat submission PROCESSING', async () => {
  const { pool } = makePool(scoringRoutes({ submissionState: 'PROCESSING' }));
  const scoring = new ScoringService(pool);

  await assert.rejects(scoring.submit(9, 3, true), { code: DEFERRED_CODE });
});

test('submission worker (onBehalfOfSubmission) lolos guard dan menulis hasil + statusOverride', async () => {
  const statusOverrideCapture = [];
  const { pool, log } = makePool(scoringRoutes({ submissionState: 'PROCESSING', statusOverrideCapture }));
  const scoring = new ScoringService(pool);

  const result = await scoring.submit(9, 3, true, { onBehalfOfSubmission: true, statusOverride: 'EXPIRED' });

  assert.equal(result.status, 'selesai');
  assert.equal(statusOverrideCapture.length, 1);
  assert.equal(statusOverrideCapture[0][0], 'EXPIRED');
  assert.ok(log.some((entry) => entry.sql.startsWith('INSERT INTO exam_results')));
});

test('tanpa statusOverride, parameter override bernilai NULL (klasifikasi dari expires_at)', async () => {
  const statusOverrideCapture = [];
  const { pool } = makePool(scoringRoutes({ statusOverrideCapture }));
  const scoring = new ScoringService(pool);

  await scoring.submit(9, 3, true);

  assert.equal(statusOverrideCapture[0][0], null);
});

// --- Violation AUTO_SUBMIT vs submission aktif --------------------------

test('violation AUTO_SUBMIT saat submission aktif → deferred:true tanpa melempar error', async () => {
  const connections = [];
  const makeViolationConnection = (routes) => {
    const log = [];
    const connection = {
      log,
      async beginTransaction() { log.push('BEGIN'); },
      async commit() { log.push('COMMIT'); },
      async rollback() { log.push('ROLLBACK'); },
      release() {},
      async execute(sql, params) {
        for (const [prefix, handler] of routes) if (sql.startsWith(prefix)) return handler(sql, params);
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    connections.push(connection);
    return connection;
  };
  const violationConn = makeViolationConnection([
    ['SELECT id,status,violation_count', () => [[{ id: 41, status: 'IN_PROGRESS', violation_count: 2 }]]],
    ['SELECT key_name', () => [[{ key_name: 'violation_termination_threshold', value: '3' }, { key_name: 'violation_action', value: 'AUTO_SUBMIT' }]]],
    ['INSERT IGNORE INTO violations', () => [{ affectedRows: 1 }]],
    ['UPDATE exam_attempts SET violation_count', () => [{ affectedRows: 1 }]],
  ]);
  const scoringConn = makeViolationConnection(scoringRoutes({ submissionState: 'RECEIVED' }));
  let turn = 0;
  const pool = { async getConnection() { return turn++ === 0 ? violationConn : scoringConn; } };
  const scoring = new ScoringService(pool);

  const outcome = await scoring.recordViolation(9, 3, 'violation-freeze-key', 'TAB_HIDDEN');

  assert.equal(outcome.terminated, true);
  assert.equal(outcome.deferred, true);
  assert.equal(outcome.hasil, undefined);
});

// --- Admin reset ---------------------------------------------------------

test('reset admin transaksional menghapus submission dan mengosongkan submitted_at', async () => {
  const executed = [];
  const connection = {
    async execute(sql, params = []) {
      executed.push({ sql, params });
      if (sql.startsWith('SELECT id,role,teacher_id,employee_id')) return [[{ id: 8, role: 'ADMIN', teacher_id: null, employee_id: null }]];
      if (sql.startsWith('SELECT a.*,s.is_active')) return [[{ id: 41, public_id: 'PUB1', student_id: 9, exam_id: 3, status: 'TERMINATED', violation_count: 1, expires_at: new Date(Date.now() + 3600_000).toLocaleString('sv-SE').slice(0, 19).replace('T', ' '), completed_at: null, is_active: 1, cbt_status: 'ACTIVE', exam_ends_at: new Date(Date.now() + 7200_000).toLocaleString('sv-SE').slice(0, 19).replace('T', ' ') }]];
      if (sql.startsWith('SELECT MAX(occurred_at)')) return [[{ stopped_at: null }]];
      if (sql.startsWith('SELECT score, maximum_points')) return [[]];
      if (sql.startsWith('SELECT state,skip_reason FROM exam_submissions')) return [[{ state: 'RECEIVED', skip_reason: null }]];
      return [{ affectedRows: 1 }];
    },
  };

  await resetTerminatedAttemptInTransaction(connection, 9, 3, { id: 8, role: 'ADMIN' }, 'pulihkan sesi');

  const deletesSubmission = executed.find((entry) => entry.sql.startsWith('DELETE FROM exam_submissions'));
  const deleteResults = executed.find((entry) => entry.sql.startsWith('DELETE FROM exam_results'));
  const updateAttempt = executed.find((entry) => entry.sql.startsWith("UPDATE exam_attempts SET status='IN_PROGRESS'"));
  const order = [deletesSubmission, deleteResults, updateAttempt].map((entry) => executed.indexOf(entry));
  assert.ok(deletesSubmission, 'submission row harus dihapus');
  assert.ok(deleteResults, 'hasil harus dihapus');
  assert.ok(updateAttempt, 'attempt harus dikembalikan IN_PROGRESS');
  assert.ok(order.every((index) => index >= 0) && order[0] < order[2], 'urutan lock attempt → submission konsisten');
  assert.equal(updateAttempt.params[1], 41);
  assert.match(updateAttempt.sql, /submitted_at=NULL/);
});

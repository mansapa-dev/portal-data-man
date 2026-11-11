import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

process.env.DATABASE_URL ??= 'mysql://dummy:dummy@127.0.0.1:1/arena_test';

const { studentExamRoutes } = await import('../dist/routes/student-exams.js');
const { issueToken } = await import('../dist/lib/auth.js');

/**
 * Fake pool untuk jalur submit async: TX1 acceptSubmission dijalankan sungguhan
 * di atas SQL tiruan, jadi logika route (accepted/processing/skipped/fallback)
 * ikut teruji.
 */
function makePool({ insertError = null, existingSubmission = null, results = null, attempt = { id: 41, status: 'IN_PROGRESS', expires_at: '2026-01-01 00:00:00', termination_action: null, expired: 0 } } = {}) {
  const executed = [];
  const connection = {
    async beginTransaction() { executed.push('BEGIN'); },
    async commit() { executed.push('COMMIT'); },
    async rollback() { executed.push('ROLLBACK'); },
    release() {},
    async execute(sql, params = []) {
      executed.push(sql.slice(0, 80));
      if (sql.startsWith('SELECT id,status,expires_at,termination_action')) return [[attempt]];
      if (sql.startsWith('SELECT 1 existing FROM exam_results')) return results ? [[results]] : [[]];
      if (sql.startsWith('SELECT question_count')) return results ? [[results]] : [[]];
      if (sql.startsWith('UPDATE exam_attempts SET submitted_at')) return [{ affectedRows: 1 }];
      if (sql.startsWith('INSERT INTO exam_submissions')) {
        if (insertError) { const error = new Error('Duplicate'); error.code = insertError; throw error; }
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT student_id,exam_id,state,skip_reason')) return existingSubmission ? [[existingSubmission]] : [[]];
      if (sql.startsWith('SELECT m.type,e.grade')) return [[]];
      if (sql.startsWith('UPDATE exam_attempts SET status=')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return { pool: { async getConnection() { return connection; } }, executed };
}

async function buildApp(pool, waiting) {
  const app = Fastify();
  await app.register(studentExamRoutes, { pool, waiting });
  return app;
}

function authHeaders(csrf) {
  return { authorization: `Bearer ${issueToken({ sub: 9, role: 'STUDENT', csrf, exp: Math.floor(Date.now() / 1000) + 60 })}`, 'x-csrf-token': csrf };
}

test('submit async: TX1 diterima → 200 accepted + submission_state RECEIVED', async () => {
  process.env.SUBMIT_ASYNC = 'on';
  const { pool, executed } = makePool();
  let finished = 0;
  const app = await buildApp(pool, { authorize: async () => {}, finish: async () => { finished++; } });
  try {
    const csrf = 'c'.repeat(32);
    const response = await app.inject({ method: 'POST', url: '/api/student/exams/3/submit', headers: authHeaders(csrf), payload: {} });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { status: 'accepted', submission_state: 'RECEIVED' });
    assert.ok(executed.some((sql) => sql.startsWith('INSERT INTO exam_submissions')), 'TX1 harus membuat baris submission');
    assert.equal(finished, 1, 'waiting.finish dipanggil setelah durable acceptance');
  } finally {
    await app.close();
    process.env.SUBMIT_ASYNC = 'off';
  }
});

test('submit async: submission duplikat RECEIVED → accepted tanpa membuat baris baru', async () => {
  process.env.SUBMIT_ASYNC = 'on';
  const { pool } = makePool({
    insertError: 'ER_DUP_ENTRY',
    existingSubmission: { student_id: 9, exam_id: 3, state: 'RECEIVED', skip_reason: null },
  });
  const app = await buildApp(pool, { authorize: async () => {}, finish: async () => {} });
  try {
    const csrf = 'c'.repeat(32);
    const response = await app.inject({ method: 'POST', url: '/api/student/exams/3/submit', headers: authHeaders(csrf), payload: {} });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { status: 'accepted', submission_state: 'RECEIVED' });
  } finally {
    await app.close();
    process.env.SUBMIT_ASYNC = 'off';
  }
});

test('submit async: submission duplikat PROCESSING → accepted dengan state PROCESSING', async () => {
  process.env.SUBMIT_ASYNC = 'on';
  const { pool } = makePool({
    insertError: 'ER_DUP_ENTRY',
    existingSubmission: { student_id: 9, exam_id: 3, state: 'PROCESSING', skip_reason: null },
  });
  const app = await buildApp(pool, { authorize: async () => {}, finish: async () => {} });
  try {
    const csrf = 'c'.repeat(32);
    const response = await app.inject({ method: 'POST', url: '/api/student/exams/3/submit', headers: authHeaders(csrf), payload: {} });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { status: 'accepted', submission_state: 'PROCESSING' });
  } finally {
    await app.close();
    process.env.SUBMIT_ASYNC = 'off';
  }
});

test('submit async: submission SKIPPED → 409', async () => {
  process.env.SUBMIT_ASYNC = 'on';
  const { pool } = makePool({
    insertError: 'ER_DUP_ENTRY',
    existingSubmission: { student_id: 9, exam_id: 3, state: 'SKIPPED', skip_reason: 'lease_exhausted' },
  });
  const app = await buildApp(pool, { authorize: async () => {}, finish: async () => {} });
  try {
    const csrf = 'c'.repeat(32);
    const response = await app.inject({ method: 'POST', url: '/api/student/exams/3/submit', headers: authHeaders(csrf), payload: {} });
    assert.equal(response.statusCode, 409, response.body);
  } finally {
    await app.close();
    process.env.SUBMIT_ASYNC = 'off';
  }
});

test('submit async: hasil sudah ada → 200 dengan hasil lengkap (idempoten)', async () => {
  process.env.SUBMIT_ASYNC = 'on';
  const stored = { question_count: 10, correct_count: 8, wrong_count: 1, blank_count: 1, earned_points: '8.00', maximum_points: '10.00', score: '80.00' };
  const { pool } = makePool({ results: stored });
  const app = await buildApp(pool, { authorize: async () => {}, finish: async () => {} });
  try {
    const csrf = 'c'.repeat(32);
    const response = await app.inject({ method: 'POST', url: '/api/student/exams/3/submit', headers: authHeaders(csrf), payload: {} });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.nilai, 80);
    assert.equal(body.jumlah_soal, 10);
  } finally {
    await app.close();
    process.env.SUBMIT_ASYNC = 'off';
  }
});

test('submit async: migrasi 016 belum ada → fallback jalur sinkron', async () => {
  process.env.SUBMIT_ASYNC = 'on';
  const stored = { question_count: 4, correct_count: 4, wrong_count: 0, blank_count: 0, earned_points: '4.00', maximum_points: '4.00', score: '100.00' };
  const { pool } = makePool({ results: stored, insertError: 'ER_NO_SUCH_TABLE' });
  const app = await buildApp(pool, { authorize: async () => {}, finish: async () => {} });
  try {
    const csrf = 'c'.repeat(32);
    const response = await app.inject({ method: 'POST', url: '/api/student/exams/3/submit', headers: authHeaders(csrf), payload: {} });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().nilai, 100);
  } finally {
    await app.close();
    process.env.SUBMIT_ASYNC = 'off';
  }
});

test('submit async mati (SUBMIT_ASYNC=off) → jalur sinkron lama dipakai', async () => {
  process.env.SUBMIT_ASYNC = 'off';
  const stored = { question_count: 5, correct_count: 3, wrong_count: 2, blank_count: 0, earned_points: '3.00', maximum_points: '5.00', score: '60.00' };
  const { pool, executed } = makePool({ results: stored });
  const app = await buildApp(pool, { authorize: async () => {}, finish: async () => {} });
  try {
    const csrf = 'c'.repeat(32);
    const response = await app.inject({ method: 'POST', url: '/api/student/exams/3/submit', headers: authHeaders(csrf), payload: {} });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().nilai, 60);
    assert.equal(executed.some((sql) => sql.startsWith('INSERT INTO exam_submissions')), false, 'tidak boleh membuat submission saat flag mati');
  } finally {
    await app.close();
  }
});

test('result: submission pending → 200 status processing', async () => {
  process.env.SUBMIT_ASYNC = 'on';
  const pool = {
    async execute(sql) {
      if (sql.includes('exam_submissions')) {
        return [[{ status: 'IN_PROGRESS', jumlah_soal: null, benar: null, salah: null, kosong: null, nilai: null, follow_up_type: null, submission_state: 'RECEIVED' }]];
      }
      return [[]];
    },
  };
  const app = await buildApp(pool, { authorize: async () => {}, finish: async () => {} });
  try {
    const csrf = 'c'.repeat(32);
    const response = await app.inject({ method: 'GET', url: '/api/student/exams/3/result', headers: authHeaders(csrf) });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { status: 'processing', submission_state: 'RECEIVED' });
  } finally {
    await app.close();
    process.env.SUBMIT_ASYNC = 'off';
  }
});

test('result: attempt IN_PROGRESS tanpa submission → 409 seperti sebelumnya', async () => {
  process.env.SUBMIT_ASYNC = 'on';
  const pool = {
    async execute(sql) {
      if (sql.includes('exam_submissions')) {
        return [[{ status: 'IN_PROGRESS', submission_state: null }]];
      }
      return [[]];
    },
  };
  const app = await buildApp(pool, { authorize: async () => {}, finish: async () => {} });
  try {
    const csrf = 'c'.repeat(32);
    const response = await app.inject({ method: 'GET', url: '/api/student/exams/3/result', headers: authHeaders(csrf) });
    assert.equal(response.statusCode, 409, response.body);
  } finally {
    await app.close();
    process.env.SUBMIT_ASYNC = 'off';
  }
});

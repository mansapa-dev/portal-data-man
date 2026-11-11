import assert from 'node:assert/strict';
import test from 'node:test';
import mysql from 'mysql2/promise';
import Fastify from 'fastify';
import { studentExamRoutes } from '../dist/routes/student-exams.js';
import { issueToken } from '../dist/lib/auth.js';
import { ScoringService } from '../dist/services/scoring.js';
import { executeSubmissionFinalization } from '../dist/services/finalization-queue.js';

/**
 * Load test Tahap 2 — submit asinkron pada MySQL sungguhan.
 *
 * Setiap level membuat cohort sendiri (exam + siswa + attempt + snapshot soal),
 * lalu semua submit dikirimkan bersamaan lewat route HTTP yang sebenarnya
 * (Fastify inject, tanpa jaringan) sehingga yang diukur adalah biaya TX1 +
 * routing + serialisasi, bukan latensi jaringan. Setelah itu worker
 * disimulasikan dengan jalur klaim sungguhan (claim → scoring → DONE) dengan
 * konkurensi 4.
 *
 * Jalankan manual:
 *   ARENA_LOAD_TEST_DB=mysql://arena_app:pw@127.0.0.1:3308/arena
 *   ARENA_LOAD_TEST_LEVELS=100,300,600,1200   (default semua)
 * Data uji dihapus di akhir (tidak ada data ujian nyata yang tersentuh).
 */
const dbUrl = process.env.ARENA_LOAD_TEST_DB;
const levels = String(process.env.ARENA_LOAD_TEST_LEVELS ?? '100,300,600,1200')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isSafeInteger(value) && value > 0);

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(2));
};

async function seedCohort(pool, size, label) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-13);
  const [exam] = await pool.execute(
    "INSERT INTO exams(public_id,name,grade,duration_minutes,session_number,starts_at,ends_at,academic_year,semester,status) VALUES(?,?,?,?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY),?,?,'DRAFT')",
    [`${label}${suffix}E`.slice(0, 26), `${label} ${suffix}`, 'X', 60, 1, '2026/2027', 'ODD'],
  );
  const examId = Number(exam.insertId);
  const [question] = await pool.execute(
    "INSERT INTO questions(public_id,exam_id,question_type,question_text,option_a,option_b,correct_answer,points,status) VALUES(?,?,'MULTIPLE_CHOICE','soal uji beban','A','B','A',1,'ACTIVE')",
    [`${label}${suffix}Q`.slice(0, 26), examId],
  );
  const questionId = Number(question.insertId);

  const students = [];
  for (let i = 0; i < size; i++) {
    const serial = String(i).padStart(5, '0');
    const [student] = await pool.execute(
      "INSERT INTO students(portal_student_id,nisn,name_snapshot,class_snapshot,grade_snapshot,academic_year_snapshot,cbt_status,is_active) VALUES(?,?,?,?,?,?,'ACTIVE',1)",
      [`${label}${suffix}S${serial}`.slice(0, 64), `L${suffix}${serial}`.slice(0, 20), `Siswa ${i}`, 'X-1', 'X', '2026/2027'],
    );
    students.push(Number(student.insertId));
  }

  const attempts = [];
  for (const studentId of students) {
    const [attempt] = await pool.execute(
      "INSERT INTO exam_attempts(public_id,student_id,exam_id,status,started_at,expires_at,question_order,option_mapping) VALUES(?,?,?,'IN_PROGRESS',UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 2 HOUR),JSON_ARRAY(1),JSON_OBJECT('1',JSON_ARRAY('A','B')))",
      [`${label}${suffix}A${studentId}`.slice(0, 26), studentId, examId],
    );
    const attemptId = Number(attempt.insertId);
    await pool.execute(
      'INSERT INTO attempt_questions(attempt_id,question_id,question_type,question_text,option_a,option_b,correct_answer,option_mapping,points) VALUES(?,?,?,?,?,?,?,?,?)',
      [attemptId, questionId, 'MULTIPLE_CHOICE', 'soal uji beban', 'A', 'B', 'A', JSON.stringify({ 1: ['A', 'B'] }), 1],
    );
    await pool.execute('INSERT INTO student_answers(attempt_id,question_id,answer) VALUES(?,?,?)', [attemptId, questionId, 'A']);
    attempts.push({ attemptId, studentId });
  }
  return { examId, questionId, students, attempts, label };
}

async function cleanupCohort(pool, cohort) {
  const attemptIds = cohort.attempts.map((attempt) => attempt.attemptId);
  if (!attemptIds.length) return;
  const chunk = 500;
  for (let i = 0; i < attemptIds.length; i += chunk) {
    const part = attemptIds.slice(i, i + chunk);
    const marks = part.map(() => '?').join(',');
    await pool.execute(`DELETE FROM exam_results WHERE attempt_id IN (${marks})`, part);
    await pool.execute(`DELETE FROM exam_submissions WHERE attempt_id IN (${marks})`, part);
    await pool.execute(`DELETE FROM exam_attempts WHERE id IN (${marks})`, part);
  }
  const studentMarks = cohort.students.map(() => '?').join(',');
  await pool.execute(`DELETE FROM students WHERE id IN (${studentMarks})`, cohort.students);
  await pool.execute('DELETE FROM exams WHERE id=?', [cohort.examId]);
}

/** Pool dengan penghitung koneksi aktif (MySQL connection usage). */
function trackedPool(pool) {
  const state = { active: 0, peak: 0 };
  const wrap = (connection) => {
    const originalRelease = connection.release.bind(connection);
    connection.release = () => { state.active--; originalRelease(); };
    return connection;
  };
  return {
    state,
    pool: {
      ...pool,
      async getConnection() { const connection = await pool.getConnection(); state.active++; state.peak = Math.max(state.peak, state.active); return wrap(connection); },
      async execute(sql, params) { return pool.execute(sql, params); },
      async query(sql, params) { return pool.query(sql, params); },
    },
  };
}

test('load test async submission: 100/300/600/1200 concurrent', { skip: !dbUrl }, async (t) => {
  process.env.SUBMIT_ASYNC = 'on';
  const base = await mysql.createPool(dbUrl, { connectionLimit: 24, waitForConnections: true, queueLimit: 0 });
  const { pool, state: poolState } = trackedPool(base);
  const report = [];
  try {
    for (const size of levels) {
    const cohort = await seedCohort(pool, size, `LT${size}`);
    const app = Fastify({ logger: false });
    await app.register(studentExamRoutes, {
      pool,
      waiting: { authorize: async () => {}, finish: async () => {}, claim: async () => { throw new Error('not used'); } },
    });
    try {
      // --- Tahap 1: acceptance bersamaan -----------------------------------
      const latencies = [];
      const errors = [];
      let accepted = 0;
      const acceptanceStart = Date.now();
      await Promise.all(cohort.attempts.map(async (attempt) => {
        const csrf = `c${String(attempt.studentId).padStart(31, '0')}`;
        const token = issueToken({ sub: attempt.studentId, role: 'STUDENT', csrf, exp: Math.floor(Date.now() / 1000) + 3600 });
        const started = performance.now();
        try {
          const response = await app.inject({
            method: 'POST',
            url: `/api/student/exams/${cohort.examId}/submit`,
            headers: { authorization: `Bearer ${token}`, 'x-csrf-token': csrf },
            payload: {},
          });
          latencies.push(performance.now() - started);
          if (response.statusCode === 200) accepted++;
          else errors.push({ statusCode: response.statusCode, body: response.body.slice(0, 160) });
        } catch (error) {
          latencies.push(performance.now() - started);
          errors.push({ statusCode: 0, body: String(error).slice(0, 160) });
        }
      }));
      const acceptanceMs = Date.now() - acceptanceStart;

      // --- Tahap 2: drain worker (konkurensi 4) -----------------------------
      const scoring = new ScoringService(pool);
      const drainStart = Date.now();
      let completed = 0;
      let drainErrors = 0;
      let next = 0;
      const worker = async () => {
        while (true) {
          const index = next++;
          if (index >= cohort.attempts.length) return;
          const attempt = cohort.attempts[index];
          try {
            await executeSubmissionFinalization(pool, scoring, attempt.studentId, cohort.examId);
            completed++;
          } catch (error) {
            drainErrors++;
            errors.push({ statusCode: 0, body: String(error).slice(0, 160) });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, cohort.attempts.length) }, worker));
      const drainMs = Date.now() - drainStart;

      // --- Verifikasi -------------------------------------------------------
      const [resultRows] = await pool.execute('SELECT COUNT(*) n, COUNT(DISTINCT attempt_id) d FROM exam_results WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [cohort.examId]);
      const [submissionRows] = await pool.execute('SELECT state, COUNT(*) n FROM exam_submissions WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?) GROUP BY state', [cohort.examId]);
      const [attemptRows] = await pool.execute("SELECT status, COUNT(*) n FROM exam_attempts WHERE exam_id=? GROUP BY status", [cohort.examId]);
      const [leaseRows] = await pool.execute('SELECT COALESCE(SUM(lease_attempts),0) attempts FROM exam_submissions WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [cohort.examId]);
      const [invariantRows] = await pool.execute(
        `SELECT COUNT(*) violations FROM exam_submissions s JOIN exam_attempts a ON a.id=s.attempt_id
          LEFT JOIN exam_results r ON r.attempt_id=s.attempt_id
          WHERE (s.state='DONE' AND (r.id IS NULL OR a.submitted_at IS NULL))
             OR (s.state IN ('RECEIVED','PROCESSING') AND a.submitted_at IS NULL)
             OR (s.state='PROCESSING' AND (s.claim_token IS NULL OR s.lease_expires_at IS NULL))`,
      );

      const states = Object.fromEntries(submissionRows.map((row) => [row.state, Number(row.n)]));
      const statuses = Object.fromEntries(attemptRows.map((row) => [row.status, Number(row.n)]));
      const deadlockErrors = errors.filter((entry) => /ER_LOCK_DEADLOCK|ER_LOCK_WAIT_TIMEOUT/.test(entry.body)).length;
      const level = {
        concurrency: size,
        accepted,
        acceptance_error_rate: Number(((errors.length / size) * 100).toFixed(2)),
        acceptance_p50_ms: percentile(latencies, 50),
        acceptance_p95_ms: percentile(latencies, 95),
        acceptance_p99_ms: percentile(latencies, 99),
        acceptance_max_ms: Number(Math.max(0, ...latencies).toFixed(2)),
        acceptance_total_ms: acceptanceMs,
        acceptance_throughput_per_sec: Number(((size / (acceptanceMs / 1000)) || 0).toFixed(1)),
        completed,
        drain_errors: drainErrors,
        drain_total_ms: drainMs,
        worker_throughput_per_sec: Number(((completed / (drainMs / 1000)) || 0).toFixed(1)),
        exam_results: Number(resultRows[0].n),
        distinct_attempt_results: Number(resultRows[0].d),
        submission_states: states,
        attempt_statuses: statuses,
        lease_attempts_total: Number(leaseRows[0].attempts),
        deadlocks_or_lock_timeouts: deadlockErrors,
        mysql_pool_peak_connections: poolState.peak,
        invariant_violations: Number(invariantRows[0].violations),
        sample_errors: errors.slice(0, 3),
      };
      report.push(level);
      t.diagnostic(JSON.stringify(level));

      assert.equal(accepted, size, 'semua submit harus diterima');
      assert.equal(level.acceptance_error_rate, 0, 'tidak boleh ada error acceptance');
      assert.equal(Number(resultRows[0].n), size, 'tepat satu hasil per attempt');
      assert.equal(Number(resultRows[0].d), size, 'tidak boleh ada hasil ganda');
      assert.equal(states.DONE, size, 'semua submission harus DONE');
      assert.equal(states.SKIPPED ?? 0, 0, 'tidak boleh ada submission SKIPPED');
      assert.equal(Number(invariantRows[0].violations), 0, 'invariant harus terpenuhi');
    } finally {
      await app.close();
      await cleanupCohort(pool, cohort);
    }
    }

    console.log('\n=== LAPORAN LOAD TEST TAHAP 2 ===');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await base.end();
    process.env.SUBMIT_ASYNC = 'off';
  }
});

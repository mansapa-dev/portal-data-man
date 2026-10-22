/**
 * local-load-test.mjs
 *
 * Controlled load test & benchmark against local MySQL database (port 3308 / arena database)
 * Tests Autosave and Submit performance across multiple concurrency levels:
 * - 25 concurrent virtual users
 * - 50 concurrent virtual users
 * - 100 concurrent virtual users
 * Measures: p50, p95, p99 latency, error rate, throughput (req/s), and database integrity.
 */

import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { StudentExamService } from '../dist/services/student-exam.js';
import { ScoringService } from '../dist/services/scoring.js';

const DATABASE_URL = process.env.DATABASE_URL || 'mysql://arena_app:74603a86071b0396f3da4099fee9840d04c78ffd6c684525@127.0.0.1:3308/arena';

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return Number(sorted[idx].toFixed(2));
}

async function runBenchmark() {
  console.log('================================================================');
  console.log('       ARENA LOCAL PERFORMANCE & CONCURRENCY BENCHMARK          ');
  console.log('================================================================\n');

  const pool = mysql.createPool({
    uri: DATABASE_URL,
    connectionLimit: 50,
    waitForConnections: true,
    queueLimit: 5000,
    enableKeepAlive: true,
    timezone: 'Z',
  });

  const connection = await pool.getConnection();
  console.log('Connected to local MySQL successfully.');

  // Setup isolated test exam & participants in test schema
  const testExamId = 999999;
  const studentExam = new StudentExamService(pool);
  const scoring = new ScoringService(pool);

  try {
    // Cleanup any prior test run
    await connection.execute('DELETE FROM exam_results WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
    await connection.execute('DELETE FROM student_answers WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
    await connection.execute('DELETE FROM answer_write_versions WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
    await connection.execute('DELETE FROM attempt_questions WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
    await connection.execute('DELETE FROM exam_attempts WHERE exam_id=?', [testExamId]);
    await connection.execute('DELETE FROM questions WHERE exam_id=?', [testExamId]);
    await connection.execute('DELETE FROM exams WHERE id=?', [testExamId]);

    // Create benchmark exam
    await connection.execute(`
      INSERT INTO exams(id, public_id, name, grade, duration_minutes, session_number, starts_at, ends_at, academic_year, semester, status)
      VALUES(?, 'BENCHMARK_EXAM_999999', 'BENCHMARK-PERF-TEST', 'X', 120, 1, UTC_TIMESTAMP(3) - INTERVAL 10 MINUTE, UTC_TIMESTAMP(3) + INTERVAL 120 MINUTE, '2026/2027', 'ODD', 'ACTIVE')
    `, [testExamId]);

    // Create 10 benchmark questions
    for (let q = 1; q <= 10; q++) {
      await connection.execute(`
        INSERT INTO questions(id, public_id, exam_id, question_type, question_text, option_a, option_b, option_c, option_d, option_e, correct_answer, points, status)
        VALUES(?, ?, ?, 'MULTIPLE_CHOICE', 'Pertanyaan Uji Beban', 'Opsi A', 'Opsi B', 'Opsi C', 'Opsi D', '', 'A', 1.00, 'ACTIVE')
      `, [900000 + q, `BENCH_Q_${900000 + q}`, testExamId]);
    }

    // Get 100 student IDs from existing students
    const [students] = await connection.execute('SELECT id FROM students WHERE is_active=1 LIMIT 100');
    if (students.length < 25) throw new Error('Not enough students in database for load test');
    const studentIds = students.map((s) => Number(s.id));

    console.log(`Initialized benchmark exam #${testExamId} with ${studentIds.length} test participants.\n`);

    // Prepare attempts for each participant
    const attempts = [];
    for (const studentId of studentIds) {
      const publicId = randomUUID().replaceAll('-', '').slice(0, 26).toUpperCase();
      const [res] = await connection.execute(`
        INSERT INTO exam_attempts(public_id, student_id, exam_id, status, started_at, expires_at, question_order, option_mapping)
        VALUES(?, ?, ?, 'IN_PROGRESS', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 120 MINUTE, '[900001, 900002, 900003]', '{"900001":["A","B","C","D"],"900002":["A","B","C","D"],"900003":["A","B","C","D"]}')
      `, [publicId, studentId, testExamId]);

      const attemptId = res.insertId;
      for (let q = 1; q <= 3; q++) {
        await connection.execute(`
          INSERT INTO attempt_questions(attempt_id, question_id, question_type, question_text, option_a, option_b, option_c, option_d, option_e, correct_answer, option_mapping, points)
          VALUES(?, ?, 'MULTIPLE_CHOICE', 'Teks Soal Snapshot', 'Opsi A', 'Opsi B', 'Opsi C', 'Opsi D', NULL, 'A', '["A","B","C","D"]', 1.00)
        `, [attemptId, 900000 + q]);
      }

      attempts.push({ studentId, attemptId, publicId });
    }

    connection.release();

    // Run test waves: 25, 50, 100 concurrency
    const concurrencyLevels = [25, 50, 100];
    const resultsTable = [];

    for (const concurrency of concurrencyLevels) {
      console.log(`--- Running Wave: Concurrency = ${concurrency} Virtual Users ---`);
      const targetParticipants = attempts.slice(0, concurrency);

      // Autosave Wave (Each VU sends answers to Q1 and Q2)
      const autosaveLatencies = [];
      let autosaveSuccess = 0;
      let autosaveErrors = 0;
      const startAutosaveWave = performance.now();

      await Promise.all(targetParticipants.map(async (p) => {
        const claims = { sub: p.studentId, role: 'STUDENT', exp: Math.floor(Date.now() / 1000) + 3600, csrf: 'test' };
        // Save Q1
        const t1 = performance.now();
        try {
          await studentExam.saveAnswer(claims, testExamId, 900001, {
            answer: 'A',
            is_flagged: false,
            attempt_id: p.publicId,
            base_revision: 0,
            mutation_id: `mut-${p.studentId}-q1-${randomUUID().slice(0, 16)}`,
          });
          autosaveLatencies.push(performance.now() - t1);
          autosaveSuccess++;
        } catch {
          autosaveErrors++;
        }

        // Save Q2
        const t2 = performance.now();
        try {
          await studentExam.saveAnswer(claims, testExamId, 900002, {
            answer: 'B',
            is_flagged: true,
            attempt_id: p.publicId,
            base_revision: 0,
            mutation_id: `mut-${p.studentId}-q2-${randomUUID().slice(0, 16)}`,
          });
          autosaveLatencies.push(performance.now() - t2);
          autosaveSuccess++;
        } catch {
          autosaveErrors++;
        }
      }));

      const autosaveDurationSec = (performance.now() - startAutosaveWave) / 1000;
      const autosaveRps = ((autosaveSuccess + autosaveErrors) / autosaveDurationSec).toFixed(1);

      // Submit Wave (Each VU submits the exam)
      const submitLatencies = [];
      let submitSuccess = 0;
      let submitErrors = 0;
      const startSubmitWave = performance.now();

      await Promise.all(targetParticipants.map(async (p) => {
        const t0 = performance.now();
        try {
          const res = await scoring.submit(p.studentId, testExamId, false);
          submitLatencies.push(performance.now() - t0);
          if (res && res.status === 'selesai') submitSuccess++;
          else submitErrors++;
        } catch {
          submitErrors++;
        }
      }));

      const submitDurationSec = (performance.now() - startSubmitWave) / 1000;
      const submitRps = ((submitSuccess + submitErrors) / submitDurationSec).toFixed(1);

      resultsTable.push({
        concurrency,
        autosave_ops: autosaveSuccess,
        autosave_p50_ms: percentile(autosaveLatencies, 0.5),
        autosave_p95_ms: percentile(autosaveLatencies, 0.95),
        autosave_p99_ms: percentile(autosaveLatencies, 0.99),
        autosave_rps: autosaveRps,
        autosave_error_rate: `${((autosaveErrors / (autosaveSuccess + autosaveErrors || 1)) * 100).toFixed(1)}%`,
        submit_p50_ms: percentile(submitLatencies, 0.5),
        submit_p95_ms: percentile(submitLatencies, 0.95),
        submit_rps: submitRps,
        submit_error_rate: `${((submitErrors / (submitSuccess + submitErrors || 1)) * 100).toFixed(1)}%`,
      });

      // Reset attempts back to IN_PROGRESS and remove answers/results for next wave if any
      if (concurrency < 100) {
        const conn = await pool.getConnection();
        await conn.execute('DELETE FROM exam_results WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
        await conn.execute('DELETE FROM student_answers WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
        await conn.execute('DELETE FROM answer_write_versions WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
        await conn.execute("UPDATE exam_attempts SET status='IN_PROGRESS', completed_at=NULL WHERE exam_id=?", [testExamId]);
        conn.release();
      }
    }

    console.log('\n================================================================');
    console.log('                 BENCHMARK RESULTS TABLE                        ');
    console.log('================================================================');
    console.table(resultsTable);

    // Verify Database Integrity post-test
    const verifyConn = await pool.getConnection();
    const [finalResults] = await verifyConn.execute('SELECT count(*) total_results FROM exam_results WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
    const [finalAnswers] = await verifyConn.execute('SELECT count(*) total_answers FROM student_answers WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
    const [finalAttempts] = await verifyConn.execute('SELECT count(*) completed_attempts FROM exam_attempts WHERE exam_id=? AND status="COMPLETED"', [testExamId]);

    console.log('\n--- DATA INTEGRITY VERIFICATION ---');
    console.log(`Total exam results written: ${finalResults[0].total_results} (Expected: 100)`);
    console.log(`Total student answers written: ${finalAnswers[0].total_answers} (Expected: 200)`);
    console.log(`Total completed attempts: ${finalAttempts[0].completed_attempts} (Expected: 100)`);

    assert.equal(Number(finalResults[0].total_results), 100, 'All 100 attempts must have exactly 1 result');
    assert.equal(Number(finalAnswers[0].total_answers), 200, 'All 200 answers must be intact in database');
    assert.equal(Number(finalAttempts[0].completed_attempts), 100, 'All 100 attempts must be COMPLETED');

    console.log('\n✔ All Data Integrity Invariants PASSED!');

    // Cleanup benchmark exam
    await verifyConn.execute('DELETE FROM exam_results WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
    await verifyConn.execute('DELETE FROM student_answers WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
    await verifyConn.execute('DELETE FROM answer_write_versions WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
    await verifyConn.execute('DELETE FROM attempt_questions WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?)', [testExamId]);
    await verifyConn.execute('DELETE FROM exam_attempts WHERE exam_id=?', [testExamId]);
    await verifyConn.execute('DELETE FROM questions WHERE exam_id=?', [testExamId]);
    await verifyConn.execute('DELETE FROM exams WHERE id=?', [testExamId]);
    verifyConn.release();

  } finally {
    await pool.end();
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

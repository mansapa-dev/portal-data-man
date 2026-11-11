import assert from 'node:assert/strict';
import test from 'node:test';
import mysql from 'mysql2/promise';
import {
  acceptSubmission,
  claimSubmission,
  completeSubmission,
  renewLease,
  skipSubmission,
  DEFERRED_CODE,
} from '../dist/services/exam-submission.js';
import { ScoringService } from '../dist/services/scoring.js';

/**
 * Race-condition test Tahap 2 memakai MySQL/InnoDB sungguhan (bukan mock):
 * blocking row lock, FOR UPDATE, dan unique constraint hanya terbukti di
 * engine yang sama dengan production.
 *
 * Jalankan manual (test di-skip tanpa env):
 *   ARENA_SUBMISSION_TEST_DB=mysql://arena_app:pw@127.0.0.1:3308/arena
 * Data uji dibuat dan dibersihkan sendiri (CASCADE ke attempt/hasil).
 */
const dbUrl = process.env.ARENA_SUBMISSION_TEST_DB;

const seed = async (pool, { expired = false, tag = 'CONC' } = {}) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const [exam] = await pool.execute(
    "INSERT INTO exams(public_id,name,grade,duration_minutes,session_number,starts_at,ends_at,academic_year,semester,status) VALUES(?,?,?,?,?,?,?,?,?,'DRAFT')",
    [`${tag}${suffix}E`.slice(0, 26), `${tag} ${suffix}`, 'X', 60, 1, new Date(Date.now() - 7200_000), new Date(Date.now() + 7200_000), '2026/2027', 'ODD'],
  );
  const examId = Number(exam.insertId);
  const [question] = await pool.execute(
    "INSERT INTO questions(public_id,exam_id,question_type,question_text,option_a,option_b,correct_answer,points,status) VALUES(?,?,'MULTIPLE_CHOICE','soal uji','A','B','A',1,'ACTIVE')",
    [`${tag}${suffix}Q`.slice(0, 26), examId],
  );
  const questionId = Number(question.insertId);
  const [student] = await pool.execute(
    "INSERT INTO students(portal_student_id,nisn,name_snapshot,class_snapshot,grade_snapshot,academic_year_snapshot,cbt_status,is_active) VALUES(?,?,?,?,?,?,'ACTIVE',1)",
    [`${tag}${suffix}S`.slice(0, 64), `9${suffix}`.slice(0, 20), 'Siswa Uji', 'X-1', 'X', '2026/2027'],
  );
  const studentId = Number(student.insertId);
  // expires_at dihitung oleh MySQL (UTC) agar perbandingan dengan
  // UTC_TIMESTAMP(3) konsisten dengan guard waktu di server.
  const expiresExpr = expired ? 'DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE)' : 'DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR)';
  const [attempt] = await pool.execute(
    `INSERT INTO exam_attempts(public_id,student_id,exam_id,status,started_at,expires_at,question_order,option_mapping) VALUES(?,?,?,'IN_PROGRESS',UTC_TIMESTAMP(3),${expiresExpr},JSON_ARRAY(1),JSON_OBJECT('1',JSON_ARRAY('A','B')))`,
    [`${tag}${suffix}A`.slice(0, 26), studentId, examId],
  );
  const attemptId = Number(attempt.insertId);
  await pool.execute(
    'INSERT INTO attempt_questions(attempt_id,question_id,question_type,question_text,option_a,option_b,correct_answer,option_mapping,points) VALUES(?,?,?,?,?,?,?,?,?)',
    [attemptId, questionId, 'MULTIPLE_CHOICE', 'soal uji', 'A', 'B', 'A', JSON.stringify({ 1: ['A', 'B'] }), 1],
  );
  await pool.execute('INSERT INTO student_answers(attempt_id,question_id,answer) VALUES(?,?,?)', [attemptId, questionId, 'A']);
  return { examId, questionId, studentId, attemptId };
};

const cleanup = async (pool, ids) => {
  await pool.execute('DELETE FROM exam_results WHERE attempt_id=?', [ids.attemptId]);
  await pool.execute('DELETE FROM exam_submissions WHERE attempt_id=?', [ids.attemptId]);
  await pool.execute('DELETE FROM exam_attempts WHERE id=?', [ids.attemptId]);
  await pool.execute('DELETE FROM students WHERE id=?', [ids.studentId]);
  await pool.execute('DELETE FROM exams WHERE id=?', [ids.examId]);
};

const countResults = async (pool, attemptId) => {
  const [rows] = await pool.execute('SELECT COUNT(*) n FROM exam_results WHERE attempt_id=?', [attemptId]);
  return Number(rows[0].n);
};

const readSubmission = async (pool, attemptId) => {
  const [rows] = await pool.execute('SELECT state,skip_reason,claim_token,lease_attempts FROM exam_submissions WHERE attempt_id=?', [attemptId]);
  return rows[0] ?? null;
};

test('S1 — job scanner terantre sebelum TX1: TX1 commit lalu worker klaim → submission worker, 1 hasil, DONE', { skip: !dbUrl }, async () => {
  const pool = await mysql.createPool(dbUrl);
  const ids = await seed(pool);
  try {
    // Scanner lama sudah menaruh job di antrean sebelum siswa menekan submit.
    const queued = { studentId: ids.studentId, examId: ids.examId };
    assert.ok(queued.examId > 0);

    const outcome = await acceptSubmission(pool, ids.studentId, ids.examId);
    assert.deepEqual(outcome, { kind: 'accepted' });

    // Worker lama mengambil job yang tadinya "legacy": kini klaim submission.
    const claim = await claimSubmission(pool, ids.studentId, ids.examId);
    assert.equal(claim.kind, 'claimed');
    assert.equal(claim.acceptedExpired, false);

    const scoring = new ScoringService(pool);
    await scoring.submit(ids.studentId, ids.examId, false, { onBehalfOfSubmission: true, statusOverride: 'COMPLETED' });
    const completed = await completeSubmission(pool, ids.attemptId, claim.token, { claimedHadResults: claim.hadResults });
    assert.equal(completed, 'done');

    assert.equal(await countResults(pool, ids.attemptId), 1);
    const submission = await readSubmission(pool, ids.attemptId);
    assert.equal(submission.state, 'DONE');
    const [attempt] = await pool.execute('SELECT status,submitted_at FROM exam_attempts WHERE id=?', [ids.attemptId]);
    assert.equal(attempt[0].status, 'COMPLETED');
    assert.ok(attempt[0].submitted_at, 'freeze marker harus terisi');
  } finally {
    await cleanup(pool, ids);
    await pool.end();
  }
});

test('S2 — worker klaim lebih dahulu (tanpa submission) → legacy scoring, TX1 berikutnya → fast path result-exists', { skip: !dbUrl }, async () => {
  const pool = await mysql.createPool(dbUrl);
  const ids = await seed(pool, { expired: true });
  try {
    const claim = await claimSubmission(pool, ids.studentId, ids.examId);
    assert.equal(claim.kind, 'legacy');

    const scoring = new ScoringService(pool);
    await scoring.submit(ids.studentId, ids.examId, true);
    assert.equal(await countResults(pool, ids.attemptId), 1);

    // TX1 datang setelah hasillegacy: fast path, tidak boleh membuat submission.
    const outcome = await acceptSubmission(pool, ids.studentId, ids.examId);
    assert.deepEqual(outcome, { kind: 'result-exists' });
    assert.equal(await readSubmission(pool, ids.attemptId), null);
    assert.equal(await countResults(pool, ids.attemptId), 1);
  } finally {
    await cleanup(pool, ids);
    await pool.end();
  }
});

test('S3 — TX1 berjalan saat worker mencoba klaim: klaim menunggu lock attempt lalu melihat submission', { skip: !dbUrl }, async () => {
  const pool = await mysql.createPool(dbUrl);
  const ids = await seed(pool);
  const blocker = await pool.getConnection();
  try {
    await blocker.beginTransaction();
    await blocker.execute('SELECT id FROM exam_attempts WHERE id=? FOR UPDATE', [ids.attemptId]);

    const tx1 = acceptSubmission(pool, ids.studentId, ids.examId);
    const claim = claimSubmission(pool, ids.studentId, ids.examId);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await blocker.commit();
    blocker.release();

    const [tx1Outcome, claimOutcome] = await Promise.all([tx1, claim]);
    assert.deepEqual(tx1Outcome, { kind: 'accepted' });
    // Worker tidak boleh melihat "tidak ada submission" lalu落后 TX1.
    assert.equal(claimOutcome.kind, 'claimed');
    const submission = await readSubmission(pool, ids.attemptId);
    assert.equal(submission.state, 'PROCESSING');
  } finally {
    try { await blocker.rollback(); blocker.release(); } catch { /* sudah dilepas */ }
    await cleanup(pool, ids);
    await pool.end();
  }
});

test('S4 — legacy scoring dan TX1 berebut lock attempt: tidak ada hasil ganda, tidak ada deadlock', { skip: !dbUrl }, async () => {
  const pool = await mysql.createPool(dbUrl);
  const ids = await seed(pool, { expired: true });
  try {
    const scoring = new ScoringService(pool);
    const legacy = scoring.submit(ids.studentId, ids.examId, true).then((value) => ({ kind: 'legacy', value }), (error) => ({ kind: 'legacy-error', error }));
    const tx1 = acceptSubmission(pool, ids.studentId, ids.examId).then((value) => ({ kind: 'tx1', value }), (error) => ({ kind: 'tx1-error', error }));
    const [legacyOutcome, tx1Outcome] = await Promise.all([legacy, tx1]);

    assert.equal(await countResults(pool, ids.attemptId), 1, 'tepat satu hasil');
    const submission = await readSubmission(pool, ids.attemptId);
    if (submission) {
      // TX1 menang balapan: legacy harus mundur (DEFERRED) dan submission yangahit.
      assert.equal(tx1Outcome.kind, 'tx1');
      assert.equal(legacyOutcome.kind, 'legacy-error');
      assert.equal(legacyOutcome.error.code, DEFERRED_CODE);
    } else {
      // Legacy menang: TX1 melihat hasil dan tidak membuat submission.
      assert.equal(tx1Outcome.kind, 'tx1');
      assert.deepEqual(tx1Outcome.value, { kind: 'result-exists' });
    }
  } finally {
    await cleanup(pool, ids);
    await pool.end();
  }
});

test('S5 — admin reset bersamaan dengan worker: reset menang, worker stale tidak bisa memfinalisasi', { skip: !dbUrl }, async () => {
  const pool = await mysql.createPool(dbUrl);
  const ids = await seed(pool);
  try {
    await acceptSubmission(pool, ids.studentId, ids.examId);
    const claim = await claimSubmission(pool, ids.studentId, ids.examId);
    assert.equal(claim.kind, 'claimed');

    // Admin reset (transaksi): hapus submission + submitted_at, kembalikan IN_PROGRESS.
    const reset = await pool.getConnection();
    try {
      await reset.beginTransaction();
      await reset.execute('SELECT id FROM exam_attempts WHERE id=? FOR UPDATE', [ids.attemptId]);
      await reset.execute('DELETE FROM exam_submissions WHERE attempt_id=?', [ids.attemptId]);
      await reset.execute("UPDATE exam_attempts SET status='IN_PROGRESS',completed_at=NULL,submitted_at=NULL WHERE id=?", [ids.attemptId]);
      await reset.commit();
    } finally {
      reset.release();
    }

    // Worker lama selesai scoring lalu mencoba menandai DONE dengan token lamanya.
    const scoring = new ScoringService(pool);
    await scoring.submit(ids.studentId, ids.examId, false, { onBehalfOfSubmission: true, statusOverride: 'COMPLETED' });
    const completed = await completeSubmission(pool, ids.attemptId, claim.token, { claimedHadResults: claim.hadResults });
    assert.equal(completed, 'reset_detected');

    assert.equal(await readSubmission(pool, ids.attemptId), null, 'submission tidak boleh dihidupkan kembali');
    const [attempt] = await pool.execute('SELECT status,submitted_at FROM exam_attempts WHERE id=?', [ids.attemptId]);
    assert.equal(attempt[0].status, 'IN_PROGRESS');
    assert.equal(attempt[0].submitted_at, null);
    assert.equal(await countResults(pool, ids.attemptId), 0, 'hasil yang ditulis worker setelah reset harus dihapus');
  } finally {
    await cleanup(pool, ids);
    await pool.end();
  }
});

test('S6 — dua worker mengklaim submission yang sama: tepat satu pemilik, lease_attempts=1', { skip: !dbUrl }, async () => {
  const pool = await mysql.createPool(dbUrl);
  const ids = await seed(pool);
  try {
    await acceptSubmission(pool, ids.studentId, ids.examId);
    const [a, b] = await Promise.all([
      claimSubmission(pool, ids.studentId, ids.examId),
      claimSubmission(pool, ids.studentId, ids.examId),
    ]);
    const claimed = [a, b].filter((outcome) => outcome.kind === 'claimed');
    assert.equal(claimed.length, 1, 'tepat satu worker boleh memiliki submission');
    const submission = await readSubmission(pool, ids.attemptId);
    assert.equal(submission.state, 'PROCESSING');
    assert.equal(Number(submission.lease_attempts), 1);
    assert.ok(submission.claim_token);
  } finally {
    await cleanup(pool, ids);
    await pool.end();
  }
});

test('S7 — worker lama mencoba finalize setelah lease diambil alih worker baru: token lama tidak berkuasa', { skip: !dbUrl }, async () => {
  const pool = await mysql.createPool(dbUrl);
  const ids = await seed(pool);
  try {
    await acceptSubmission(pool, ids.studentId, ids.examId);
    const first = await claimSubmission(pool, ids.studentId, ids.examId);
    assert.equal(first.kind, 'claimed');

    // Lease worker lama kedaluwarsa → worker baru mengambil alih.
    await pool.execute('UPDATE exam_submissions SET lease_expires_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE attempt_id=?', [ids.attemptId]);
    const second = await claimSubmission(pool, ids.studentId, ids.examId);
    assert.equal(second.kind, 'claimed');
    assert.notEqual(second.token, first.token);

    // Worker lama: renew + finalize tidak boleh mengubah apa pun.
    assert.equal(await renewLease(pool, ids.attemptId, first.token, 60_000), false);
    assert.equal(await completeSubmission(pool, ids.attemptId, first.token, { claimedHadResults: first.hadResults }), 'taken_over');
    assert.equal(await skipSubmission(pool, ids.attemptId, first.token, 'rejected'), 'taken_over');

    const submission = await readSubmission(pool, ids.attemptId);
    assert.equal(submission.state, 'PROCESSING', 'state milik worker baru tidak boleh diubah worker lama');
    assert.equal(submission.claim_token, second.token);

    // Worker baru menutup submission dengan tokennya sendiri.
    assert.equal(await completeSubmission(pool, ids.attemptId, second.token, { claimedHadResults: second.hadResults }), 'done');
    assert.equal((await readSubmission(pool, ids.attemptId)).state, 'DONE');
  } finally {
    await cleanup(pool, ids);
    await pool.end();
  }
});

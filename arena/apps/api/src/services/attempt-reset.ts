import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

type ResetActor = { id: number; role: string };

export type AttemptResetOptions = {
  /** Hapus jawaban lama + versi tulis agar peserta mulai dari kosong. */
  clearAnswers?: boolean;
  /** Beri durasi penuh baru dari exams.duration_minutes, walau jadwal sudah tutup. */
  restartFullDuration?: boolean;
  /** Hanya izinkan attempt yang sudah selesai (COMPLETED/EXPIRED/TERMINATED). */
  requireFinished?: boolean;
};

/** Reset implementation shared by direct staff reset and ticket resolution.
 * The caller owns the transaction so ticket + attempt + audit can commit atomically.
 */
export async function resetTerminatedAttemptInTransaction(
  connection: PoolConnection,
  studentId: number,
  examId: number,
  claimedActor: ResetActor,
  reason: string,
  options: AttemptResetOptions = {},
) {
  const [staffRows] = await connection.execute<RowDataPacket[]>(
    "SELECT id,role,teacher_id,employee_id FROM users WHERE id=? AND status='ACTIVE' FOR UPDATE",
    [claimedActor.id],
  );
  const staff = staffRows[0];
  if (!staff || staff.role !== claimedActor.role) {
    throw Object.assign(new Error('Akun atau hak akses petugas sudah tidak aktif'), { statusCode: 403 });
  }

  // Reset sesi boleh dilakukan ADMIN atau petugas piket (proctor) yang aktif.
  // Keputusan tetap tercatat di audit_logs lengkap dengan peran pelakunya.
  let authorized = staff.role === 'ADMIN';
  if (!authorized) {
    const [proctorRows] = await connection.execute<RowDataPacket[]>(`SELECT (
      EXISTS(SELECT 1 FROM teacher_exam_assignments a JOIN users u ON ((u.role='TEACHER' AND u.teacher_id=a.teacher_id) OR (u.role='EMPLOYEE' AND u.employee_id=a.employee_id)) WHERE u.id=? AND u.status='ACTIVE' AND a.duty_role='PROCTOR' AND a.exam_id IS NULL)
      OR EXISTS(SELECT 1 FROM teachers t JOIN users u ON u.teacher_id=t.id WHERE u.id=? AND u.role='TEACHER' AND u.status='ACTIVE' AND t.status='ACTIVE' AND t.proctor_eligible=1)
    ) ok`, [claimedActor.id, claimedActor.id]);
    authorized = Boolean(proctorRows[0]?.ok);
  }
  if (!authorized) {
    throw Object.assign(new Error('Pemulihan sesi hanya dapat dilakukan oleh admin atau petugas piket aktif'), { statusCode: 403 });
  }

  const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT a.*,s.is_active,s.cbt_status,e.ends_at exam_ends_at,e.duration_minutes exam_duration_minutes FROM exam_attempts a JOIN students s ON s.id=a.student_id JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? AND a.exam_id=? FOR UPDATE',
    [studentId, examId],
  );
  const attempt = rows[0];
  // Pemulihan sesi bebas: attempt dalam status apa pun (TERMINATED, EXPIRED, COMPLETED,
  // bahkan IN_PROGRESS) boleh dipulihkan berapa kali pun oleh admin/petugas piket — tidak
  // ada lagi batas jumlah reset maupun syarat status/pelanggaran. Syaratnya satu: masih
  // ada sisa waktu yang bisa dikembalikan ke siswa.
  if (!attempt) {
    throw Object.assign(new Error('Sesi ujian peserta tidak ditemukan'), { statusCode: 404 });
  }
  if (!attempt.is_active || attempt.cbt_status !== 'ACTIVE') {
    throw Object.assign(new Error('Akun siswa tidak aktif'), { statusCode: 409 });
  }
  // Reset nilai hanya untuk attempt yang benar-benar sudah selesai. Sesi yang
  // sedang berjalan tidak boleh dihapus jawabannya di tengah ujian.
  if (options.requireFinished && !['COMPLETED', 'EXPIRED', 'TERMINATED'].includes(String(attempt.status))) {
    throw Object.assign(new Error('Reset nilai hanya untuk ujian yang sudah selesai'), { statusCode: 409 });
  }

  const [lastRows] = await connection.execute<RowDataPacket[]>(
    'SELECT MAX(occurred_at) stopped_at FROM violations WHERE attempt_id=?', [attempt.id],
  );
  const lastViolation = lastRows[0]?.stopped_at ? new Date(lastRows[0].stopped_at).getTime() : null;
  // Admin manual terminations set completed_at without a trailing violation event, so the
  // more recent of the two marks when the session stopped.
  const completedAt = attempt.completed_at ? new Date(attempt.completed_at).getTime() : null;
  const stoppedAt = Math.max(lastViolation ?? 0, completedAt ?? 0) || Date.now();
  // Reset nilai selalu memberi durasi penuh baru dari durasi ujian, sehingga
  // tetap bisa dikerjakan walau jadwal ujian sudah tutup. Mode pemulihan biasa
  // (resume) tetap memakai sisa waktu seperti sebelumnya.
  const restartFullDuration = options.restartFullDuration === true;
  let expiresAt: string;
  if (restartFullDuration) {
    const durationMinutes = Math.min(600, Math.max(1, Number(attempt.exam_duration_minutes) || 60));
    expiresAt = new Date(Date.now() + durationMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  } else {
    // Fallback cerdas: kalau waktu attempt sendiri sudah lewat, pakai sisa jadwal ujian
    // (exams.ends_at) selama jadwalnya masih terbuka.
    let effectiveRemaining = new Date(attempt.expires_at as string | Date).getTime() - stoppedAt;
    if (effectiveRemaining <= 0) {
      const examEnd = attempt.exam_ends_at ? new Date(attempt.exam_ends_at as string | Date).getTime() : null;
      const untilExamEnd = examEnd != null ? examEnd - Date.now() : 0;
      if (untilExamEnd <= 0) {
        throw Object.assign(new Error('Sisa waktu ujian sudah habis. Perpanjang jadwal ujian terlebih dahulu, lalu pulihkan sesi ini.'), { statusCode: 409 });
      }
      effectiveRemaining = untilExamEnd;
    }
    expiresAt = new Date(Date.now() + effectiveRemaining).toISOString().slice(0, 19).replace('T', ' ');
  }
  const [resultRows] = await connection.execute<RowDataPacket[]>(
    'SELECT score, maximum_points, earned_points FROM exam_results WHERE attempt_id=? FOR UPDATE', [attempt.id],
  );
  const before: Record<string, unknown> = {
    status: attempt.status,
    violation_count: Number(attempt.violation_count),
    expires_at: attempt.expires_at,
    previous_result: resultRows[0] ?? null,
  };
  const [submissionRows] = await connection.execute<RowDataPacket[]>(
    'SELECT state,skip_reason FROM exam_submissions WHERE attempt_id=?', [attempt.id],
  );
  before.submission_state = submissionRows[0]?.state ?? null;
  const after: Record<string, unknown> = {
    status: 'IN_PROGRESS',
    violation_count: 0,
    expires_at: expiresAt,
    reason: reason.trim().slice(0, 1000),
  };
  // Invariant I5 (desain A3): reset admin menghapus baris submission dan freeze
  // marker secara atomik dengan pengembalian status attempt — tidak ada
  // submission aktif yang bisa memfinalisasi attempt lama setelah reset. Urutan
  // lock tetap exam_attempts (sudah FOR UPDATE di atas) → exam_submissions.
  // Worker lama yang sedang memproses submission ini akan mendeteksi baris
  // hilang via token fencing (completeSubmission → reset_detected) dan
  // mengembalikan hasil yang ditulisnya.
  await connection.execute('DELETE FROM exam_submissions WHERE attempt_id=?', [attempt.id]);
  await connection.execute('DELETE FROM exam_results WHERE attempt_id=?', [attempt.id]);
  // Hapus klaim waiting room lama agar siswa bisa masuk ulang lewat antrian
  // baru tanpa ditolak "Token sesi ujian berubah".
  await connection.execute('DELETE FROM exam_waiting_claims WHERE exam_id=? AND student_id=?', [examId, studentId]);
  let clearedAnswers = 0;
  if (options.clearAnswers) {
    const [answerRows] = await connection.execute<RowDataPacket[]>(
      "SELECT COUNT(*) total FROM student_answers WHERE attempt_id=? AND answer IS NOT NULL AND TRIM(answer)<>''",
      [attempt.id],
    );
    clearedAnswers = Number(answerRows[0]?.total ?? 0);
    before.answer_count = clearedAnswers;
    // Hapus jawaban + versi tulis sekaligus. Tanpa menghapus versi, klien bisa
    // memuat revision lama dan menolak jawaban baru saat mengerjakan ulang.
    await connection.execute('DELETE FROM student_answers WHERE attempt_id=?', [attempt.id]);
    await connection.execute('DELETE FROM answer_write_versions WHERE attempt_id=?', [attempt.id]);
  }
  after.cleared_answers = clearedAnswers;
  if (restartFullDuration) {
    await connection.execute(
      "UPDATE exam_attempts SET status='IN_PROGRESS',violation_count=0,termination_action=NULL,completed_at=NULL,submitted_at=NULL,started_at=UTC_TIMESTAMP(3),expires_at=?,face_status='UNKNOWN',face_absence_started_at=NULL WHERE id=?",
      [expiresAt, attempt.id],
    );
  } else {
    await connection.execute(
      "UPDATE exam_attempts SET status='IN_PROGRESS',violation_count=0,termination_action=NULL,completed_at=NULL,submitted_at=NULL,expires_at=?,face_status='UNKNOWN',face_absence_started_at=NULL WHERE id=?",
      [expiresAt, attempt.id],
    );
  }
  await connection.execute(
    "INSERT INTO audit_logs(actor_user_id,actor_role,action,entity_type,entity_id,before_data,after_data) VALUES(?,?,?,'ExamAttempt',?,?,?)",
    [claimedActor.id, staff.role, options.clearAnswers ? 'CBT_SCORE_RESET' : 'CBT_ATTEMPT_RESUMED', attempt.public_id, JSON.stringify(before), JSON.stringify(after)],
  );
  return { attempt_id: attempt.public_id, expires_at: `${expiresAt}Z` };
}

export async function resetTerminatedAttempt(
  pool: Pool,
  studentId: number,
  examId: number,
  actorId: number,
  role: string,
  reason: string,
  options: AttemptResetOptions = {},
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await resetTerminatedAttemptInTransaction(connection, studentId, examId, { id: actorId, role }, reason, options);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* transaction may already be closed */ }
    throw error;
  } finally {
    connection.release();
  }
}

import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

type ResetActor = { id: number; role: string };

/** Reset implementation shared by direct staff reset and ticket resolution.
 * The caller owns the transaction so ticket + attempt + audit can commit atomically.
 */
export async function resetTerminatedAttemptInTransaction(
  connection: PoolConnection,
  studentId: number,
  examId: number,
  claimedActor: ResetActor,
  reason: string,
) {
  const [staffRows] = await connection.execute<RowDataPacket[]>(
    "SELECT id,role,teacher_id,employee_id FROM users WHERE id=? AND status='ACTIVE' FOR UPDATE",
    [claimedActor.id],
  );
  const staff = staffRows[0];
  if (!staff || staff.role !== claimedActor.role) {
    throw Object.assign(new Error('Akun atau hak akses petugas sudah tidak aktif'), { statusCode: 403 });
  }

  // Reset after violation termination is an ADMIN-only action: teachers/proctors can
  // review violations but the session recovery decision (restoring remaining time) is
  // reserved for the administrator.
  const authorized = staff.role === 'ADMIN';
  if (!authorized) {
    throw Object.assign(new Error('Pemulihan sesi hanya dapat dilakukan oleh admin'), { statusCode: 403 });
  }

  const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT a.*,s.is_active,s.cbt_status,e.ends_at exam_ends_at FROM exam_attempts a JOIN students s ON s.id=a.student_id JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? AND a.exam_id=? FOR UPDATE',
    [studentId, examId],
  );
  const attempt = rows[0];
  // Pemulihan sesi bebas: attempt dalam status apa pun (TERMINATED, EXPIRED, COMPLETED,
  // bahkan IN_PROGRESS) boleh dipulihkan berapa kali pun oleh admin — tidak ada lagi
  // batas jumlah reset maupun syarat status/pelanggaran. Syaratnya satu: masih ada
  // sisa waktu yang bisa dikembalikan ke siswa.
  if (!attempt) {
    throw Object.assign(new Error('Sesi ujian peserta tidak ditemukan'), { statusCode: 404 });
  }
  if (!attempt.is_active || attempt.cbt_status !== 'ACTIVE') {
    throw Object.assign(new Error('Akun siswa tidak aktif'), { statusCode: 409 });
  }

  const [lastRows] = await connection.execute<RowDataPacket[]>(
    'SELECT MAX(occurred_at) stopped_at FROM violations WHERE attempt_id=?', [attempt.id],
  );
  const lastViolation = lastRows[0]?.stopped_at ? new Date(lastRows[0].stopped_at).getTime() : null;
  // Admin manual terminations set completed_at without a trailing violation event, so the
  // more recent of the two marks when the session stopped.
  const completedAt = attempt.completed_at ? new Date(attempt.completed_at).getTime() : null;
  const stoppedAt = Math.max(lastViolation ?? 0, completedAt ?? 0) || Date.now();
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

  const expiresAt = new Date(Date.now() + effectiveRemaining).toISOString().slice(0, 19).replace('T', ' ');
  const [resultRows] = await connection.execute<RowDataPacket[]>(
    'SELECT score, maximum_points, earned_points FROM exam_results WHERE attempt_id=? FOR UPDATE', [attempt.id],
  );
  const before = {
    status: attempt.status,
    violation_count: Number(attempt.violation_count),
    expires_at: attempt.expires_at,
    previous_result: resultRows[0] ?? null,
  };
  const after = {
    status: 'IN_PROGRESS',
    violation_count: 0,
    expires_at: expiresAt,
    reason: reason.trim().slice(0, 1000),
  };
  await connection.execute('DELETE FROM exam_results WHERE attempt_id=?', [attempt.id]);
  await connection.execute(
    "UPDATE exam_attempts SET status='IN_PROGRESS',violation_count=0,completed_at=NULL,expires_at=? WHERE id=?",
    [expiresAt, attempt.id],
  );
  await connection.execute(
    "INSERT INTO audit_logs(actor_user_id,actor_role,action,entity_type,entity_id,before_data,after_data) VALUES(?,?,'CBT_ATTEMPT_RESUMED','ExamAttempt',?,?,?)",
    [claimedActor.id, staff.role, attempt.public_id, JSON.stringify(before), JSON.stringify(after)],
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
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await resetTerminatedAttemptInTransaction(connection, studentId, examId, { id: actorId, role }, reason);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* transaction may already be closed */ }
    throw error;
  } finally {
    connection.release();
  }
}

import type { Pool, RowDataPacket } from 'mysql2/promise';

export async function staffCapabilities(pool: Pool, userId: number, role: string) {
  if (role === 'ADMIN') return { teacher: true, proctor: true };
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT
    EXISTS(SELECT 1 FROM teacher_exam_assignments a JOIN users u ON (u.teacher_id IS NOT NULL AND u.teacher_id=a.teacher_id) OR (u.employee_id IS NOT NULL AND u.employee_id=a.employee_id) WHERE u.id=? AND a.duty_role='TEACHER' AND a.exam_id IS NOT NULL) teacher,
    EXISTS(SELECT 1 FROM teacher_exam_assignments a JOIN users u ON (u.teacher_id IS NOT NULL AND u.teacher_id=a.teacher_id) OR (u.employee_id IS NOT NULL AND u.employee_id=a.employee_id) WHERE u.id=? AND a.duty_role='PROCTOR' AND a.exam_id IS NULL) proctor`, [userId, userId]);
  return { teacher: Boolean(rows[0]?.teacher), proctor: Boolean(rows[0]?.proctor) };
}

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { hashSync } from 'bcryptjs';
import { issueToken } from '../apps/api/dist/lib/auth.js';
import { ExamAdmissionService } from '../apps/api/dist/services/exam-admission.js';

const url = process.env.DATABASE_URL;
if (!url || !['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname) || process.env.NODE_ENV === 'production') {
  throw new Error('Seed performa hanya boleh memakai DATABASE_URL lokal dan NODE_ENV non-production');
}
if (!process.env.AUTH_TOKEN_SECRET || process.env.AUTH_TOKEN_SECRET.length < 32) throw new Error('Atur AUTH_TOKEN_SECRET dummy lokal minimal 32 karakter');
const pool = mysql.createPool({ uri: url, connectionLimit: 4, timezone: 'Z' });
const pinHash = hashSync('1234', 10);
const now = Date.now();
const staggered = process.env.EXAM_GRADE_ADMISSION_ENABLED !== 'false';
const grades = staggered ? ['XII', 'XI', 'X'] : ['X'];
const schedule = { academic_year: `PERF-${randomBytes(8).toString('hex')}`, semester: 'ODD', starts_at: new Date(now - 60000), session_number: 1 };
const admission = new ExamAdmissionService(null, { enabled: staggered });
const students = Array.from({ length: 1015 }, (_, index) => {
  const number = String(index + 1).padStart(4, '0');
  const grade = staggered ? (index < 340 ? 'XII' : index < 680 ? 'XI' : 'X') : 'X';
  return [`arena-perf-${number}`, `990000${number}`, `Siswa Dummy ${number}`, `${grade} Perf`, grade, pinHash, 'ACTIVE', 1];
});
try {
  for (let offset = 0; offset < students.length; offset += 100) {
    await pool.query(`INSERT INTO students(portal_student_id,nisn,name_snapshot,class_snapshot,grade_snapshot,pin_hash,cbt_status,is_active)
      VALUES ? ON DUPLICATE KEY UPDATE name_snapshot=VALUES(name_snapshot),class_snapshot=VALUES(class_snapshot),grade_snapshot=VALUES(grade_snapshot),pin_hash=VALUES(pin_hash),cbt_status='ACTIVE',is_active=1`, [students.slice(offset, offset + 100)]);
  }
  const examIds = {};
  for (const grade of grades) {
    const examPublicId = `PERF${randomBytes(11).toString('hex').toUpperCase()}`;
    const [exam] = await pool.execute(`INSERT INTO exams(public_id,name,grade,duration_minutes,session_number,starts_at,ends_at,academic_year,semester,subject_name,status)
      VALUES(?,?,?,60,1,?,?,?,'ODD','Simulasi Lokal','ACTIVE')`,
      [examPublicId, `Ujian Performa Dummy ${grade}`, grade, schedule.starts_at, new Date(now + 24 * 3600000), schedule.academic_year]);
    examIds[grade] = exam.insertId;
    const questions = Array.from({ length: 40 }, (_, index) => [createHash('sha256').update(`${examPublicId}:${index}`).digest('hex').slice(0, 26).toUpperCase(), exam.insertId, 'MULTIPLE_CHOICE', `<p>Soal dummy nomor ${index + 1}</p>`, 'Pilihan A', 'Pilihan B', 'Pilihan C', 'Pilihan D', 'A', 1, 'ACTIVE']);
    await pool.query(`INSERT INTO questions(public_id,exam_id,question_type,question_text,option_a,option_b,option_c,option_d,correct_answer,points,status) VALUES ?`, [questions]);
  }
  const [rows] = await pool.query(`SELECT id,portal_student_id,grade_snapshot FROM students WHERE portal_student_id LIKE 'arena-perf-%' ORDER BY portal_student_id LIMIT 1015`);
  if (rows.length !== 1015) throw new Error(`Jumlah siswa dummy tidak sesuai: ${rows.length}`);
  const users = rows.map((row) => {
    const csrf = randomBytes(32).toString('hex');
    const examId = examIds[row.grade_snapshot];
    return { student_id: Number(row.id), grade: row.grade_snapshot, exam_id: examId, admission_ticket: admission.ticket(Number(row.id), examId, row.grade_snapshot, schedule), csrf, token: issueToken({ sub: Number(row.id), role: 'STUDENT', csrf, exp: Math.floor(Date.now() / 1000) + 12 * 3600 }) };
  });
  await mkdir(new URL('../tmp/', import.meta.url), { recursive: true });
  await writeFile(new URL('../tmp/perf-tokens.json', import.meta.url), JSON.stringify({ exam_id: examIds[grades[0]], exam_ids: Object.values(examIds), grade_admission: staggered, users }), { mode: 0o600 });
  console.log(`Seed lokal selesai: ujian=${JSON.stringify(examIds)}, siswa=${users.length}, soal=40 per tingkat. Token dummy: arena/tmp/perf-tokens.json`);
} finally { await pool.end(); }

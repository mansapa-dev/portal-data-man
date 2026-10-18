import mysql from 'mysql2/promise';
import { hash } from 'bcryptjs';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL harus diatur lewat arena/.env');

const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, timezone: 'Z' });
const demo = {
  admin: { username: 'admin.demo', password: '', name: 'Admin Demo Arena' },
  teacher: { username: 'guru.demo', password: 'ArenaGuru!2026', name: 'Guru Demo Arena' },
  student: { nisn: '0000000001', pin: '1234', name: 'Siswa Demo Arena', className: 'X Demo', grade: 'X' },
};
function encryptPin(pin){const secret=process.env.PIN_ENCRYPTION_KEY??process.env.AUTH_TOKEN_SECRET??'';const key=createHash('sha256').update(secret||'local-development-only').digest();const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([cipher.update(pin,'utf8'),cipher.final()]);return `v1:${Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64')}`;}

async function getOrCreateStaff(connection, { username, password, name, role, teacherId = null }, encodedPassword) {
  await connection.execute(
    `INSERT INTO users(teacher_id,username,password_hash,name,role,status)
     VALUES(?,?,?,?,?,'ACTIVE')
     ON DUPLICATE KEY UPDATE teacher_id=VALUES(teacher_id),password_hash=VALUES(password_hash),name=VALUES(name),role=VALUES(role),status='ACTIVE'`,
    [teacherId, username, encodedPassword, name, role],
  );
  const [rows] = await connection.execute('SELECT id FROM users WHERE username=? LIMIT 1', [username]);
  return Number(rows[0].id);
}

try {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const adminId = await getOrCreateStaff(connection, { ...demo.admin, role: 'ADMIN' }, await hash(demo.admin.password, 10));
    await connection.execute(
      `INSERT INTO teachers(portal_teacher_id,nip,name_snapshot,status,proctor_eligible)
       VALUES('arena-local-demo-teacher','DEMO-ARENA-01',?,'ACTIVE',1)
       ON DUPLICATE KEY UPDATE name_snapshot=VALUES(name_snapshot),status='ACTIVE',proctor_eligible=1`,
      [demo.teacher.name],
    );
    const [teacherRows] = await connection.execute('SELECT id FROM teachers WHERE portal_teacher_id=? LIMIT 1', ['arena-local-demo-teacher']);
    const teacherId = Number(teacherRows[0].id);
    const teacherUserId = await getOrCreateStaff(connection, { ...demo.teacher, role: 'TEACHER', teacherId }, await hash(demo.teacher.password, 10));

    await connection.execute(
      `INSERT INTO students(portal_student_id,nisn,name_snapshot,class_snapshot,grade_snapshot,pin_hash,pin_encrypted,cbt_status,is_active)
       VALUES('arena-local-demo-student',?,?,?,?,?,?,'ACTIVE',1)
       ON DUPLICATE KEY UPDATE nisn=VALUES(nisn),name_snapshot=VALUES(name_snapshot),class_snapshot=VALUES(class_snapshot),grade_snapshot=VALUES(grade_snapshot),pin_hash=VALUES(pin_hash),pin_encrypted=VALUES(pin_encrypted),cbt_status='ACTIVE',is_active=1`,
      [demo.student.nisn, demo.student.name, demo.student.className, demo.student.grade, await hash(demo.student.pin, 10), encryptPin(demo.student.pin)],
    );

    const [existingExams] = await connection.execute('SELECT id FROM exams WHERE public_id=? LIMIT 1', ['01JARENADEMO00000000000000']);
    let examId;
    const now = Date.now();
    const startsAt = new Date(now - 60 * 60_000).toISOString().slice(0, 23).replace('T', ' ');
    const endsAt = new Date(now + 30 * 24 * 60 * 60_000).toISOString().slice(0, 23).replace('T', ' ');
    if (existingExams[0]) {
      examId = Number(existingExams[0].id);
      await connection.execute(
        `UPDATE exams SET name=?,grade='X',duration_minutes=90,starts_at=?,ends_at=?,academic_year='2026/2027',semester='ODD',subject_name='Simulasi Lokal',status='ACTIVE' WHERE id=?`,
        ['Ujian Demo Arena — Bahasa Indonesia', startsAt, endsAt, examId],
      );
    } else {
      const [inserted] = await connection.execute(
        `INSERT INTO exams(public_id,name,grade,duration_minutes,session_number,starts_at,ends_at,academic_year,semester,subject_name,status)
         VALUES(?,?,'X',90,1,?,?,'2026/2027','ODD','Simulasi Lokal','ACTIVE')`,
        ['01JARENADEMO00000000000000', 'Ujian Demo Arena — Bahasa Indonesia', startsAt, endsAt],
      );
      examId = Number(inserted.insertId);
    }

    const questions = [
      ['01JARENAQUESTION0000000001', 'MULTIPLE_CHOICE', '<p>Manakah kalimat yang menggunakan ejaan baku?</p>', 'Aktivitas siswa dimulai pagi hari.', 'Aktifitas siswa dimulai pagi hari.', 'Siswa menganalisa hasil diskusi.', 'Jadual ujian sudah dibagikan.', 'A', 1],
      ['01JARENAQUESTION0000000002', 'SHORT_ANSWER', '<p>Tuliskan sinonim dari kata <strong>cermat</strong>.</p>', null, null, null, null, 'teliti|saksama', 1],
    ];
    for (const [publicId, type, text, a, b, c, d, answer, points] of questions) {
      await connection.execute(
        `INSERT INTO questions(public_id,exam_id,question_type,question_text,option_a,option_b,option_c,option_d,correct_answer,points,status)
         VALUES(?,?,?,?,?,?,?,?,?,?,'ACTIVE')
         ON DUPLICATE KEY UPDATE exam_id=VALUES(exam_id),question_type=VALUES(question_type),question_text=VALUES(question_text),option_a=VALUES(option_a),option_b=VALUES(option_b),option_c=VALUES(option_c),option_d=VALUES(option_d),correct_answer=VALUES(correct_answer),points=VALUES(points),status='ACTIVE'`,
        [publicId, examId, type, text, a, b, c, d, answer, points],
      );
    }
    await connection.execute(
      `INSERT INTO teacher_exam_assignments(teacher_id,employee_id,exam_id,duty_role,created_by)
       VALUES(?,NULL,?,'TEACHER',?) ON DUPLICATE KEY UPDATE duty_role='TEACHER',created_by=VALUES(created_by)`,
      [teacherId, examId, adminId],
    );
    // Keep the demo student's in-progress attempt usable when the local seed is
    // rerun on a later day. Preserve its saved answers and question order.
    await connection.execute(
      `UPDATE exam_attempts a JOIN students s ON s.id=a.student_id JOIN exams e ON e.id=a.exam_id
       SET a.started_at=UTC_TIMESTAMP(3),
           a.expires_at=LEAST(DATE_ADD(UTC_TIMESTAMP(3),INTERVAL e.duration_minutes MINUTE),e.ends_at)
       WHERE s.portal_student_id='arena-local-demo-student' AND e.public_id='01JARENADEMO00000000000000'
         AND a.status='IN_PROGRESS' AND a.expires_at<=UTC_TIMESTAMP(3)`,
    );
    await connection.commit();
    console.log(`Akun demo siap: admin=${demo.admin.username}, guru=${demo.teacher.username}, siswa NISN=${demo.student.nisn}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
} finally {
  await pool.end();
}

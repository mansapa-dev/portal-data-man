import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL harus diatur lewat arena/.env');
const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: true });
try {
  for (const file of ['001_core.sql', '002_staff_admin.sql', '003_exam_retake_candidates.sql', '004_exam_lookup_indexes.sql', '005_remove_staff_admin_communications.sql', '006_exam_integrity_signals.sql', '007_student_pin_ciphertext.sql', '008_perf_indexes.sql', '009_violation_threshold.sql', '010_violation_anti_copy.sql']) {
    await connection.query(await readFile(new URL(`../database/migrations/${file}`, import.meta.url), 'utf8'));
    console.log(`Applied ${file}`);
  }
} finally {
  await connection.end();
}

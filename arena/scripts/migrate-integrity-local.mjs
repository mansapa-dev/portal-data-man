import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL harus diatur lewat arena/.env');
const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: true });
try {
  await connection.query(await readFile(new URL('../database/migrations/006_exam_integrity_signals.sql', import.meta.url), 'utf8'));
  console.log('Applied 006_exam_integrity_signals.sql');
  await connection.query(await readFile(new URL('../database/migrations/007_student_pin_ciphertext.sql', import.meta.url), 'utf8'));
  console.log('Applied 007_student_pin_ciphertext.sql');
} finally {
  await connection.end();
}

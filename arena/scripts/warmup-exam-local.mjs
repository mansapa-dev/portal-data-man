import mysql from 'mysql2/promise';
import { redis } from '../apps/api/dist/lib/redis.js';
import { loadExamQuestionSource } from '../apps/api/dist/services/exam-question-source.js';

const examId = Number(process.argv[2]);
const databaseUrl = process.env.DATABASE_URL;
if (!Number.isSafeInteger(examId) || examId < 1) throw new Error('Gunakan: node scripts/warmup-exam-local.mjs EXAM_ID');
if (!databaseUrl || !['127.0.0.1','localhost','::1'].includes(new URL(databaseUrl).hostname) || !redis || !process.env.REDIS_URL || !['127.0.0.1','localhost','::1'].includes(new URL(process.env.REDIS_URL).hostname)) {
  throw new Error('Warmup CLI ini hanya boleh memakai DB dan Redis lokal');
}
const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 1 });
try {
  await redis.ping();
  const rows = await loadExamQuestionSource(examId, async () => {
    const [questions] = await pool.execute("SELECT id,question_type,question_text,option_a,option_b,option_c,option_d,option_e,correct_answer,points FROM questions WHERE exam_id=? AND status='ACTIVE' ORDER BY id", [examId]);
    return questions;
  });
  if (!rows.length) throw new Error('Paket soal aktif tidak ditemukan');
  console.log(`Warmup Redis selesai: exam_id=${examId}, soal=${rows.length}`);
} finally { await pool.end(); await redis.quit(); }

import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !['127.0.0.1','localhost','::1'].includes(new URL(databaseUrl).hostname)) throw new Error('Verifikasi hanya boleh memakai DB lokal');
const fixture = JSON.parse(await readFile(new URL('../tmp/perf-tokens.json', import.meta.url), 'utf8'));
const examIds = fixture.exam_ids ?? [fixture.exam_id];
const expected = Number(process.env.EXPECTED_FINISHES ?? fixture.users.length);
if (!Number.isSafeInteger(expected) || expected < 1) throw new Error('EXPECTED_FINISHES tidak valid');
const placeholders = examIds.map(() => '?').join(',');
const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 1 });
try {
  const [[counts]] = await pool.execute(`SELECT
    COUNT(*) attempts,
    SUM(a.status IN ('COMPLETED','EXPIRED')) finished,
    SUM(r.id IS NOT NULL) results,
    COUNT(DISTINCT r.id) distinct_results
    FROM exam_attempts a LEFT JOIN exam_results r ON r.attempt_id=a.id WHERE a.exam_id IN (${placeholders})`, examIds);
  const [[answers]] = await pool.execute(`SELECT COUNT(*) answers FROM student_answers sa JOIN exam_attempts a ON a.id=sa.attempt_id WHERE a.exam_id IN (${placeholders})`, examIds);
  console.log(JSON.stringify({ exam_ids: examIds, attempts: Number(counts.attempts), finished: Number(counts.finished ?? 0), results: Number(counts.results ?? 0), distinct_results: Number(counts.distinct_results ?? 0), answers: Number(answers.answers) }, null, 2));
  if (Number(counts.results ?? 0) !== expected || Number(counts.finished ?? 0) !== Number(counts.results ?? 0) || Number(counts.results ?? 0) !== Number(counts.distinct_results ?? 0)) process.exitCode = 1;
} finally { await pool.end(); }

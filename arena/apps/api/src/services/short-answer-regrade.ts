import type { Pool, RowDataPacket } from 'mysql2/promise';
import { fraction, getExamMeta } from './scoring.js';

export async function regradeShortAnswerAttempt(pool: Pool, attemptId: number, questionId?: number) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [attempts] = await connection.execute<RowDataPacket[]>('SELECT id,exam_id,status FROM exam_attempts WHERE id=? FOR UPDATE', [attemptId]);
    const attempt = attempts[0];
    if (!attempt || attempt.status === 'IN_PROGRESS') {
      await connection.rollback();
      return false;
    }
    const [results] = await connection.execute<RowDataPacket[]>('SELECT id,question_count,correct_count,wrong_count,blank_count,earned_points,maximum_points,score FROM exam_results WHERE attempt_id=? FOR UPDATE', [attemptId]);
    const previous = results[0];
    if (!previous) {
      await connection.rollback();
      return false;
    }
    const params = questionId ? [attemptId, questionId] : [attemptId];
    await connection.execute(`UPDATE attempt_questions aq JOIN questions q ON q.id=aq.question_id
      SET aq.correct_answer=q.correct_answer
      WHERE aq.attempt_id=? AND aq.question_type='SHORT_ANSWER' AND q.question_type='SHORT_ANSWER'${questionId ? ' AND aq.question_id=?' : ''}`, params);
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT q.question_type,q.correct_answer,q.points,a.answer,
      ((q.option_a IS NOT NULL AND q.option_a<>'') + (q.option_b IS NOT NULL AND q.option_b<>'') + (q.option_c IS NOT NULL AND q.option_c<>'') + (q.option_d IS NOT NULL AND q.option_d<>'') + (q.option_e IS NOT NULL AND q.option_e<>'')) option_count
      FROM attempt_questions q LEFT JOIN student_answers a ON a.attempt_id=q.attempt_id AND a.question_id=q.question_id WHERE q.attempt_id=?`, [attemptId]);
    const totals = rows.reduce((sum, row) => {
      const points = Number(row.points);
      sum.maximum += points;
      if (row.answer === null) sum.blank++;
      else {
        const value = fraction(String(row.question_type), String(row.correct_answer), String(row.answer), Number(row.option_count));
        sum.earned += points * value;
        if (value >= 1) sum.correct++; else sum.wrong++;
      }
      return sum;
    }, { correct: 0, wrong: 0, blank: 0, earned: 0, maximum: 0 });
    const { scoreCap } = await getExamMeta(connection, Number(attempt.exam_id));
    let score = totals.maximum > 0 ? Math.round(totals.earned / totals.maximum * 10000) / 100 : 0;
    if (scoreCap !== null) score = Math.min(score, Math.round(scoreCap * 100) / 100);
    const changed = Number(previous.correct_count) !== totals.correct || Number(previous.wrong_count) !== totals.wrong || Number(previous.blank_count) !== totals.blank || Math.abs(Number(previous.earned_points) - totals.earned) > 0.001 || Number(previous.score) !== score;
    if (changed) await connection.execute('UPDATE exam_results SET question_count=?,correct_count=?,wrong_count=?,blank_count=?,earned_points=?,maximum_points=?,score=? WHERE id=?', [rows.length, totals.correct, totals.wrong, totals.blank, totals.earned, totals.maximum, score, previous.id]);
    await connection.commit();
    return changed;
  } catch (error) {
    try { await connection.rollback(); } catch { /* transaction already finished */ }
    throw error;
  } finally {
    connection.release();
  }
}

export async function regradeShortAnswerQuestion(pool: Pool, questionId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT DISTINCT aq.attempt_id FROM attempt_questions aq
    JOIN exam_results r ON r.attempt_id=aq.attempt_id WHERE aq.question_id=? AND aq.question_type='SHORT_ANSWER' ORDER BY aq.attempt_id`, [questionId]);
  let changed = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      if (row && await regradeShortAnswerAttempt(pool, Number(row.attempt_id), questionId)) changed++;
    }
  });
  await Promise.all(workers);
  return { checked: rows.length, changed };
}

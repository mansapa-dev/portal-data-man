import type { Pool, RowDataPacket } from 'mysql2/promise';

function normalize(text: string) { return text.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('id-ID'); }
function fraction(type: string, key: string, answer: string, optionCount: number) {
  if (type === 'SHORT_ANSWER') {
    const given = normalize(answer);
    return given !== '' && key.split('|').some((accepted) => normalize(accepted) === given) ? 1 : 0;
  }
  const correct = [...new Set(key.toUpperCase().split(',').map((v) => v.trim()).filter(Boolean))].sort();
  const selected = [...new Set(answer.toUpperCase().split(',').map((v) => v.trim()).filter(Boolean))].sort();
  if (type !== 'MULTIPLE_RESPONSE') return JSON.stringify(correct) === JSON.stringify(selected) ? 1 : 0;
  const right = selected.filter((value) => correct.includes(value)).length;
  const wrong = selected.filter((value) => !correct.includes(value)).length;
  return Math.max(0, Math.min(1, right / Math.max(1, correct.length) - wrong / Math.max(1, optionCount - correct.length)));
}

export class ScoringService {
  constructor(private readonly pool: Pool) {}

  async submit(studentId:number,examId:number,finalizeOnly=false,retry=0):Promise<unknown>{try{return await this.submitOnce(studentId,examId,finalizeOnly);}catch(error){const code=(error as {code?:string}).code;if(retry<2&&['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(code??'')){await new Promise((resolve)=>setTimeout(resolve,10+Math.floor(Math.random()*30)));return this.submit(studentId,examId,finalizeOnly,retry+1);}throw error;}}

  private async submitOnce(studentId: number, examId: number, finalizeOnly = false) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [attemptRows] = await connection.execute<RowDataPacket[]>('SELECT id,status,expires_at,(expires_at<=UTC_TIMESTAMP(3)) expired FROM exam_attempts WHERE student_id=? AND exam_id=? FOR UPDATE', [studentId, examId]);
      const attempt = attemptRows[0];
      if (!attempt) throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 });
      const [existingRows] = await connection.execute<RowDataPacket[]>('SELECT question_count,correct_count,wrong_count,blank_count,earned_points,maximum_points,score FROM exam_results WHERE attempt_id=?', [attempt.id]);
      const existing = existingRows[0];
      if (existing) {
        if (attempt.status === 'IN_PROGRESS') await connection.execute("UPDATE exam_attempts SET status=IF(expires_at<=UTC_TIMESTAMP(3),'EXPIRED','COMPLETED'),completed_at=COALESCE(completed_at,UTC_TIMESTAMP(3)) WHERE id=?", [attempt.id]);
        const [followUps] = await connection.execute<RowDataPacket[]>('SELECT m.type,e.grade FROM exam_follow_up_meta m JOIN exams e ON e.id=m.exam_id WHERE m.exam_id=? LIMIT 1', [examId]);
        let scoreCap: number | null = null;
        const isRemedial = followUps[0]?.type === 'REMEDIAL';
        if (isRemedial) {
          const followUp = followUps[0]!;
          const [settings] = await connection.execute<RowDataPacket[]>('SELECT value FROM cbt_settings WHERE key_name=? LIMIT 1', [`remedial_score_cap_${String(followUp.grade).toUpperCase().trim()}`]);
          scoreCap = settings[0] ? Number(settings[0].value) : 75;
        }
        await connection.commit();
        return this.format(existing, isRemedial, scoreCap);
      }
      if (finalizeOnly && attempt.status === 'IN_PROGRESS' && !Number(attempt.expired)) throw Object.assign(new Error('Ujian masih aktif'), { statusCode: 409 });
      if (!['IN_PROGRESS', 'TERMINATED'].includes(attempt.status)) throw Object.assign(new Error('Ujian tidak dapat disubmit'), { statusCode: 409 });
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT q.question_id,q.question_type,q.correct_answer,q.option_a,q.option_b,q.option_c,q.option_d,q.option_e,q.points,a.answer
        FROM attempt_questions q LEFT JOIN student_answers a ON a.attempt_id=q.attempt_id AND a.question_id=q.question_id WHERE q.attempt_id=?`, [attempt.id]);
      if (!rows.length) throw Object.assign(new Error('Snapshot soal tidak tersedia'), { statusCode: 409 });
      const totals = rows.reduce((result, row) => {
        const points = Number(row.points); result.maximum += points;
        if (row.answer === null) result.blank++;
        else {
          const available = [row.option_a,row.option_b,row.option_c,row.option_d,row.option_e].filter((value) => String(value ?? '').trim() !== '').length;
          const score = fraction(row.question_type, row.correct_answer, row.answer, available);
          result.earned += points * score;
          if (score >= 1) result.correct++; else result.wrong++;
        }
        return result;
      }, { correct: 0, wrong: 0, blank: 0, earned: 0, maximum: 0 });
      let score = totals.maximum > 0 ? Math.round((totals.earned / totals.maximum * 100) * 100) / 100 : 0;
      const [followUpRows] = await connection.execute<RowDataPacket[]>('SELECT m.type,e.grade FROM exam_follow_up_meta m JOIN exams e ON e.id=m.exam_id WHERE m.exam_id=? LIMIT 1', [examId]);
      let isRemedial = false;
      let scoreCap: number | null = null;
      if (followUpRows[0]?.type === 'REMEDIAL') {
        isRemedial = true;
        const capKey = `remedial_score_cap_${String(followUpRows[0].grade).toUpperCase().trim()}`;
        const [settings] = await connection.execute<RowDataPacket[]>('SELECT value FROM cbt_settings WHERE key_name=? LIMIT 1', [capKey]);
        scoreCap = settings[0] ? Number(settings[0].value) : 75;
        if (score > scoreCap) score = Math.round(scoreCap * 100) / 100;
      }
      await connection.execute(`INSERT INTO exam_results(attempt_id,question_count,correct_count,wrong_count,blank_count,earned_points,maximum_points,score) VALUES(?,?,?,?,?,?,?,?)`, [attempt.id, rows.length, totals.correct, totals.wrong, totals.blank, totals.earned, totals.maximum, score]);
      await connection.execute("UPDATE exam_attempts SET status=IF(status='TERMINATED','TERMINATED',IF(expires_at<=UTC_TIMESTAMP(3),'EXPIRED','COMPLETED')),completed_at=UTC_TIMESTAMP(3) WHERE id=?", [attempt.id]);
      await connection.commit();
      return { jumlah_soal: rows.length, benar: totals.correct, salah: totals.wrong, kosong: totals.blank, total_poin: totals.earned, nilai: score, is_remedial: isRemedial, score_cap: scoreCap, status: 'selesai' };
    } catch (error) {
      try { await connection.rollback(); } catch { /* no active transaction */ }
      throw error;
    } finally { connection.release(); }
  }

  async review(studentId: number, examId: number) {
    const [attempts] = await this.pool.execute<RowDataPacket[]>('SELECT id,status FROM exam_attempts WHERE student_id=? AND exam_id=?', [studentId, examId]);
    const attempt = attempts[0];
    if (!attempt) throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 });
    if (!['COMPLETED','EXPIRED'].includes(attempt.status)) throw Object.assign(new Error('Review hanya tersedia setelah ujian selesai'), { statusCode: 403 });
    const [attemptDetails] = await this.pool.execute<RowDataPacket[]>('SELECT question_order FROM exam_attempts WHERE id=?', [attempt.id]);
    const order = JSON.parse(attemptDetails[0]?.question_order ?? '[]') as number[];
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT q.question_id,q.question_text,q.question_type,q.correct_answer,q.option_a,q.option_b,q.option_c,q.option_d,q.option_e,a.answer FROM attempt_questions q LEFT JOIN student_answers a ON a.attempt_id=q.attempt_id AND a.question_id=q.question_id WHERE q.attempt_id=?', [attempt.id]);
    const rowByQuestion = new Map(rows.map((row) => [Number(row.question_id), row]));
    rows.splice(0, rows.length, ...order.map((id) => rowByQuestion.get(id)).filter((row): row is RowDataPacket => Boolean(row)));
    return { soal: rows.map((row) => {
      const available = [row.option_a,row.option_b,row.option_c,row.option_d,row.option_e].filter((value) => String(value ?? '').trim() !== '').length;
      const score = row.answer === null ? 0 : fraction(row.question_type, row.correct_answer, row.answer, available);
      return { id: Number(row.question_id), pertanyaan: row.question_text, status: row.answer === null ? 'KOSONG' : score >= 1 ? 'BENAR' : score > 0 ? 'SEBAGIAN' : 'SALAH' };
    }) };
  }

  async recordViolation(studentId: number, examId: number, eventKey: string, type: string) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>('SELECT id,status,violation_count FROM exam_attempts WHERE student_id=? AND exam_id=? FOR UPDATE', [studentId, examId]);
      const attempt = rows[0];
      if (!attempt) throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 });
      if (attempt.status !== 'IN_PROGRESS') { await connection.commit(); return { recorded: false, count: Number(attempt.violation_count), terminated: attempt.status === 'TERMINATED' }; }
      const [result] = await connection.execute('INSERT IGNORE INTO violations(attempt_id,event_key,type,occurred_at) VALUES(?,?,?,UTC_TIMESTAMP(3))', [attempt.id, eventKey, type]);
      const inserted = (result as { affectedRows: number }).affectedRows > 0;
      if (inserted) await connection.execute('UPDATE exam_attempts SET violation_count=LEAST(255,violation_count+1),status=IF(violation_count+1>=3,\'TERMINATED\',status) WHERE id=?', [attempt.id]);
      await connection.commit();
      const terminated = inserted && Number(attempt.violation_count) + 1 >= 3;
      const outcome: { recorded: boolean; count: number; terminated: boolean; hasil?: unknown } = { recorded: inserted, count: Number(attempt.violation_count) + Number(inserted), terminated };
      if (terminated) outcome.hasil = await this.submit(studentId, examId, true);
      return outcome;
    } catch (error) {
      try { await connection.rollback(); } catch { /* no active transaction */ }
      throw error;
    } finally { connection.release(); }
  }

  private format(row: RowDataPacket, isRemedial = false, scoreCap: number | null = null) {
    return { jumlah_soal: Number(row.question_count), benar: Number(row.correct_count), salah: Number(row.wrong_count), kosong: Number(row.blank_count), total_poin: Number(row.earned_points), nilai: Number(row.score), is_remedial: isRemedial, score_cap: scoreCap, status: 'selesai' };
  }
}

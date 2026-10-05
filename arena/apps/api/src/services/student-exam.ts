import { createHash, randomBytes } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Claims } from '../lib/auth.js';

const idChars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
  let time = Date.now(); let output = '';
  for (let i = 0; i < 10; i++) { output = idChars[time % 32] + output; time = Math.floor(time / 32); }
  for (const byte of randomBytes(16)) output += idChars[byte & 31];
  return output;
}
function shuffle<T>(items: T[], seed: string): T[] {
  return [...items].sort((a, b) => createHash('sha256').update(`${seed}:${a}`).digest('hex').localeCompare(createHash('sha256').update(`${seed}:${b}`).digest('hex')));
}
const options = ['A', 'B', 'C', 'D', 'E'];

export class StudentExamService {
  constructor(private readonly pool: Pool) {}

  async list(studentId: number) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT e.id,e.name,e.grade,e.duration_minutes,e.session_number,e.starts_at,e.ends_at,e.academic_year,e.semester,m.type follow_up_type,
      a.status attempt_status, (e.status='ACTIVE' AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at AND (a.id IS NULL OR a.status='IN_PROGRESS') AND (NOT EXISTS (SELECT 1 FROM exam_target_classes all_tc WHERE all_tc.exam_id=e.id) OR EXISTS (SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id=e.id AND tc.portal_class_id=s.portal_class_id)) AND (NOT EXISTS(SELECT 1 FROM exam_target_students all_ts WHERE all_ts.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id AND ts.student_id=s.id))) can_start
      FROM students s JOIN exams e ON e.grade=s.grade_snapshot LEFT JOIN exam_attempts a ON a.student_id=s.id AND a.exam_id=e.id LEFT JOIN exam_follow_up_meta m ON m.exam_id=e.id
      WHERE s.id=? AND s.is_active=1 AND s.cbt_status='ACTIVE' AND ((e.status='ACTIVE' AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at
      AND (NOT EXISTS (SELECT 1 FROM exam_target_classes all_tc WHERE all_tc.exam_id=e.id) OR EXISTS (SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id=e.id AND tc.portal_class_id=s.portal_class_id))
      AND (NOT EXISTS(SELECT 1 FROM exam_target_students all_ts WHERE all_ts.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id AND ts.student_id=s.id))) OR a.id IS NOT NULL) ORDER BY e.starts_at DESC,e.id`, [studentId]);
    return rows.map((row) => ({ id: Number(row.id), nama_ujian: row.name, tingkat: row.grade, durasi: Number(row.duration_minutes), sesi: Number(row.session_number), tanggal_mulai: row.starts_at, tanggal_selesai: row.ends_at, tahun_ajaran: row.academic_year, semester: row.semester, status_attempt: row.attempt_status, can_start: Boolean(row.can_start), is_special: Boolean(row.follow_up_type), special_type: row.follow_up_type ?? null }));
  }

  async start(studentId:number,examId:number,retry=0):Promise<unknown>{try{return await this.startOnce(studentId,examId);}catch(error){const code=(error as {code?:string}).code;if(retry<2&&['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','ER_DUP_ENTRY'].includes(code??'')){await new Promise((resolve)=>setTimeout(resolve,10+Math.floor(Math.random()*30)));return this.start(studentId,examId,retry+1);}throw error;}}

  private async startOnce(studentId: number, examId: number) {
    const connection = await this.pool.getConnection();
    let state: { attempt: RowDataPacket; exam: RowDataPacket; questions: RowDataPacket[]; answers: RowDataPacket[] } | undefined;
    try {
      await connection.beginTransaction();
      const [students] = await connection.execute<RowDataPacket[]>('SELECT id,portal_class_id,nisn,name_snapshot,class_snapshot,grade_snapshot,academic_year_snapshot FROM students WHERE id=? AND is_active=1 AND cbt_status=\'ACTIVE\'', [studentId]);
      const student = students[0];
      if (!student) throw Object.assign(new Error('Siswa tidak ditemukan atau tidak aktif'), { statusCode: 403 });
      const [attemptRows] = await connection.execute<RowDataPacket[]>('SELECT * FROM exam_attempts WHERE student_id=? AND exam_id=? FOR UPDATE', [studentId, examId]);
      let attempt: RowDataPacket | undefined = attemptRows[0];
      if (attempt && ['COMPLETED', 'TERMINATED', 'EXPIRED'].includes(attempt.status)) throw Object.assign(new Error('Ujian ini tidak dapat dilanjutkan'), { statusCode: 409 });
      const [examRows] = await connection.execute<RowDataPacket[]>(`SELECT e.* FROM exams e WHERE e.id=? AND e.status='ACTIVE' AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at
        AND e.grade=? AND (NOT EXISTS(SELECT 1 FROM exam_target_classes all_tc WHERE all_tc.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id=e.id AND tc.portal_class_id=?))
        AND (NOT EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id AND ts.student_id=?))`, [examId, student.grade_snapshot, student.portal_class_id, studentId]);
      const exam = examRows[0];
      if (!exam) throw Object.assign(new Error('Ujian tidak tersedia untuk siswa ini'), { statusCode: 403 });
      if (!attempt) {
        const [source] = await connection.execute<RowDataPacket[]>('SELECT id,question_type,question_text,option_a,option_b,option_c,option_d,option_e,correct_answer,points FROM questions WHERE exam_id=? AND status=\'ACTIVE\' ORDER BY id', [examId]);
        if (!source.length) throw Object.assign(new Error('Soal ujian belum tersedia'), { statusCode: 409 });
        const seed = createHash('sha256').update(`${studentId}:${examId}:${randomBytes(16).toString('hex')}`).digest('hex');
        const orderedIds = shuffle(source.map((q) => Number(q.id)), seed);
        const mapping: Record<string, string[]> = {};
        for (const questionId of orderedIds) mapping[String(questionId)] = shuffle(options, `${seed}:${questionId}`);
        const publicId = ulid();
        await connection.execute(`INSERT INTO exam_attempts(public_id,student_id,exam_id,status,started_at,expires_at,question_order,option_mapping)
          VALUES(?,?,?,'IN_PROGRESS',UTC_TIMESTAMP(3),LEAST(DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MINUTE),?),?,?)`, [publicId, studentId, examId, exam.duration_minutes, exam.ends_at, JSON.stringify(orderedIds), JSON.stringify(mapping)]);
        const [created] = await connection.execute<RowDataPacket[]>('SELECT * FROM exam_attempts WHERE student_id=? AND exam_id=? FOR UPDATE', [studentId, examId]);
        attempt = created[0];
        if (!attempt) throw Object.assign(new Error('Gagal membuat sesi ujian'), { statusCode: 503 });
        const sourceById = new Map(source.map((question) => [Number(question.id), question]));
        const snapshotRows: unknown[][] = [];
        for (const questionId of orderedIds) {
          const question = sourceById.get(questionId)!;
          const letterMap = mapping[String(questionId)]!;
          const optionsMapped = Object.fromEntries(letterMap.map((letter, index) => [letter.toLowerCase(), question[`option_${options[index]!.toLowerCase()}`]]));
          const correct = String((question as RowDataPacket).correct_answer ?? '').split(',').map((letter) => letter.trim().toUpperCase()).filter(Boolean).map((letter) => letterMap[options.indexOf(letter)]).filter(Boolean).sort().join(',');
          snapshotRows.push([attempt.id, questionId, question.question_type, question.question_text, optionsMapped.a ?? null, optionsMapped.b ?? null, optionsMapped.c ?? null, optionsMapped.d ?? null, optionsMapped.e ?? null, correct, JSON.stringify(letterMap), question.points]);
        }
        await connection.query('INSERT INTO attempt_questions(attempt_id,question_id,question_type,question_text,option_a,option_b,option_c,option_d,option_e,correct_answer,option_mapping,points) VALUES ?', [snapshotRows]);
      }
      if (!attempt) throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 });
      if (new Date(attempt.expires_at).getTime() <= Date.now()) throw Object.assign(new Error('Waktu ujian sudah habis'), { statusCode: 409 });
      const [questions] = await connection.execute<RowDataPacket[]>('SELECT question_id id,question_type,question_text,option_a,option_b,option_c,option_d,option_e,points FROM attempt_questions WHERE attempt_id=?', [attempt.id]);
      const [answers] = await connection.execute<RowDataPacket[]>('SELECT v.question_id,a.answer,COALESCE(a.is_flagged,0) is_flagged,COALESCE(v.revision,0) revision FROM answer_write_versions v LEFT JOIN student_answers a ON a.attempt_id=v.attempt_id AND a.question_id=v.question_id WHERE v.attempt_id=?', [attempt.id]);
      await connection.commit();
      state = { attempt, exam, questions, answers };
    } catch (error) {
      try { await connection.rollback(); } catch { /* no active transaction */ }
      throw error;
    } finally { connection.release(); }
    const { attempt, exam, questions, answers } = state!;
    const byId = new Map(questions.map((q) => [Number(q.id), q]));
    const mapping = JSON.parse(attempt.option_mapping) as Record<string, string[]>;
    const ordered = (JSON.parse(attempt.question_order) as number[]).map((id) => {
      const q = byId.get(Number(id));
      if (!q) return null;
      const type = q.question_type as string;
      const choices = type === 'SHORT_ANSWER' ? [] : (mapping[String(id)] ?? options).map((key) => ({ key, text: q[`option_${key.toLowerCase()}`] })).filter((choice) => choice.text !== null && choice.text !== '');
      return { id: Number(q.id), tipe: type, pertanyaan: q.question_text, opsi: choices, poin: Number(q.points) };
    }).filter(Boolean);
    return { attempt_id: attempt.public_id, exam: { id: Number(exam.id), nama_ujian: exam.name }, expires_at: attempt.expires_at, server_time: new Date().toISOString(), soal: ordered, jawaban: answers.map((a) => ({ question_id: Number(a.question_id), answer: a.answer, is_flagged: Boolean(a.is_flagged), revision: Number(a.revision) })) };
  }

  async heartbeat(studentId: number, examId: number) {
    const [attempts] = await this.pool.execute<RowDataPacket[]>(`SELECT id FROM exam_attempts WHERE student_id=? AND exam_id=? AND status='IN_PROGRESS' AND expires_at>UTC_TIMESTAMP(3)`, [studentId, examId]);
    const attempt = attempts[0];
    if (attempt) await this.pool.execute(`INSERT INTO attempt_connections(attempt_id,last_seen_at) VALUES(?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE last_seen_at=IF(last_seen_at<UTC_TIMESTAMP(3)-INTERVAL 40 SECOND,UTC_TIMESTAMP(3),last_seen_at)`, [attempt.id]);
    return { server_time: new Date().toISOString() };
  }

  async saveAnswer(claims:Claims,examId:number,questionId:number,input:{answer:string|null;is_flagged:boolean;attempt_id:string;base_revision:number;mutation_id:string},retry=0):Promise<unknown>{try{return await this.saveAnswerOnce(claims,examId,questionId,input);}catch(error){const code=(error as {code?:string}).code;if(retry<2&&['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(code??'')){await new Promise((resolve)=>setTimeout(resolve,10+Math.floor(Math.random()*30)));return this.saveAnswer(claims,examId,questionId,input,retry+1);}throw error;}}

  private async saveAnswerOnce(claims: Claims, examId: number, questionId: number, input: { answer: string | null; is_flagged: boolean; attempt_id: string; base_revision: number; mutation_id: string }) {
    if (input.base_revision < 0 || !/^[A-Za-z0-9_-]{16,100}$/.test(input.mutation_id)) throw Object.assign(new Error('Versi penyimpanan tidak valid'), { statusCode: 422 });
    const connection = await this.pool.getConnection();
    try {
      const [preflight] = await connection.execute<RowDataPacket[]>(`SELECT t.id attempt_pk,t.public_id,t.status,t.expires_at,q.question_id,q.question_type,
        (q.option_a IS NOT NULL AND q.option_a<>'') option_a_available,(q.option_b IS NOT NULL AND q.option_b<>'') option_b_available,
        (q.option_c IS NOT NULL AND q.option_c<>'') option_c_available,(q.option_d IS NOT NULL AND q.option_d<>'') option_d_available,
        (q.option_e IS NOT NULL AND q.option_e<>'') option_e_available,v.revision,v.mutation_id,a.id answer_id,a.answer,a.is_flagged
        FROM exam_attempts t JOIN attempt_questions q ON q.attempt_id=t.id AND q.question_id=?
        LEFT JOIN answer_write_versions v ON v.attempt_id=q.attempt_id AND v.question_id=q.question_id
        LEFT JOIN student_answers a ON a.attempt_id=q.attempt_id AND a.question_id=q.question_id
        WHERE t.student_id=? AND t.exam_id=?`, [questionId, claims.sub, examId]);
      const first = preflight[0];
      if (!first) throw Object.assign(new Error('Sesi ujian atau soal tidak ditemukan'), { statusCode: 404 });
      if (first.public_id !== input.attempt_id) throw Object.assign(new Error('Sesi ujian berubah; muat ulang halaman'), { statusCode: 409 });
      let answer = input.answer?.trim() || null;
      if (answer !== null) {
        if (first.question_type === 'SHORT_ANSWER') {
          if (answer.length > 500) throw Object.assign(new Error('Jawaban terlalu panjang'), { statusCode: 422 });
        } else {
          const letters = [...new Set(answer.toUpperCase().split(',').filter(Boolean))].sort();
          if (!letters.length || (first.question_type === 'MULTIPLE_CHOICE' && letters.length !== 1) || letters.some((letter) => !['A', 'B', 'C', 'D', 'E'].includes(letter) || !first[`option_${letter.toLowerCase()}_available`])) throw Object.assign(new Error('Pilihan jawaban tidak valid'), { statusCode: 422 });
          answer = letters.join(',');
        }
      }
      if (first.mutation_id === input.mutation_id) {
        if (first.answer !== answer || Boolean(first.is_flagged) !== input.is_flagged) throw Object.assign(new Error('ID mutation sudah digunakan untuk payload lain'), { statusCode: 409 });
        return { question_id: questionId, revision: Number(first.revision ?? 0), duplicate: true };
      }
      await connection.beginTransaction();
      try {
        const [lockedRows] = await connection.execute<RowDataPacket[]>('SELECT id,public_id,status,expires_at,(expires_at<=UTC_TIMESTAMP(3)) expired FROM exam_attempts WHERE student_id=? AND exam_id=? FOR UPDATE', [claims.sub, examId]);
        const attempt = lockedRows[0];
        if (!attempt) throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 });
        if (attempt.public_id !== input.attempt_id || attempt.id !== first.attempt_pk) throw Object.assign(new Error('Sesi ujian berubah; muat ulang halaman'), { statusCode: 409 });
        const [stateRows] = await connection.execute<RowDataPacket[]>('SELECT v.revision,v.mutation_id,a.id answer_id,a.answer,a.is_flagged FROM attempt_questions q LEFT JOIN answer_write_versions v ON v.attempt_id=q.attempt_id AND v.question_id=q.question_id LEFT JOIN student_answers a ON a.attempt_id=q.attempt_id AND a.question_id=q.question_id WHERE q.attempt_id=? AND q.question_id=?', [attempt.id, questionId]);
        const current = stateRows[0];
        if (!current) throw Object.assign(new Error('Soal tidak ditemukan'), { statusCode: 404 });
        const revision = current.revision === null ? 0 : Number(current.revision);
        if (current.mutation_id === input.mutation_id) {
          if (current.answer !== answer || Boolean(current.is_flagged) !== input.is_flagged) throw Object.assign(new Error('ID mutation sudah digunakan untuk payload lain'), { statusCode: 409 });
          await connection.commit();
          return { question_id: questionId, revision, duplicate: true };
        }
        if (attempt.status !== 'IN_PROGRESS' || Number(attempt.expired)) throw Object.assign(new Error('Ujian sudah tidak aktif'), { statusCode: 409 });
        if (revision !== input.base_revision) throw Object.assign(new Error('Versi jawaban berubah di tab lain'), { statusCode: 409 });
        if (current.answer_id !== null) {
          if (current.answer !== answer || Boolean(current.is_flagged) !== input.is_flagged) await connection.execute('UPDATE student_answers SET answer=?,is_flagged=?,answered_at=UTC_TIMESTAMP(3) WHERE id=?', [answer, Number(input.is_flagged), current.answer_id]);
        } else if (answer !== null || input.is_flagged) await connection.execute('INSERT INTO student_answers(attempt_id,question_id,answer,is_flagged,answered_at) VALUES(?,?,?,?,UTC_TIMESTAMP(3))', [attempt.id, questionId, answer, Number(input.is_flagged)]);
        if (current.revision === null) await connection.execute('INSERT INTO answer_write_versions(attempt_id,question_id,revision,mutation_id) VALUES(?,?,1,?)', [attempt.id, questionId, input.mutation_id]);
        else await connection.execute('UPDATE answer_write_versions SET revision=?,mutation_id=? WHERE attempt_id=? AND question_id=?', [revision + 1, input.mutation_id, attempt.id, questionId]);
        await connection.commit();
        return { question_id: questionId, answer, is_flagged: input.is_flagged, revision: revision + 1, saved_at: new Date().toISOString() };
      } catch (error) {
        try { await connection.rollback(); } catch { /* no active transaction */ }
        throw error;
      }
    } finally { connection.release(); }
  }
}

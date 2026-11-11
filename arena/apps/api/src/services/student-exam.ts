import { createHash, randomBytes } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Claims } from '../lib/auth.js';
import type { FastifyBaseLogger } from 'fastify';
import { performance } from 'node:perf_hooks';
import { loadExamQuestionSource } from './exam-question-source.js';
import type { ExamAdmissionService } from './exam-admission.js';
import type { WaitingClaimReceipt } from './waiting-room.js';

const idChars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
  let time = Date.now(); let output = '';
  for (let i = 0; i < 10; i++) { output = idChars[time % 32] + output; time = Math.floor(time / 32); }
  for (const byte of randomBytes(16)) output += idChars[byte & 31];
  return output;
}
function shuffle<T>(items: T[], seed: string): T[] {
  // Hash each item once. Hashing inside Array.sort's comparator performs
  // O(n log n) synchronous crypto work on the API event loop for every start.
  return items
    .map((item) => ({ item, rank: createHash('sha256').update(`${seed}:${item}`).digest('hex') }))
    .sort((a, b) => a.rank.localeCompare(b.rank))
    .map(({ item }) => item);
}
const options = ['A', 'B', 'C', 'D', 'E'];
function jsonValue<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

export class StudentExamService {
  private readonly diagnosticSamples = new Map<string, Record<string, number | string | boolean>[]>();
  private diagnosticTimer?: NodeJS.Timeout;

  constructor(private readonly pool: Pool, private readonly diagnostics?: FastifyBaseLogger, private readonly admission?: ExamAdmissionService) {}

  private recordDiagnostic(event: string, values: Record<string, number | string | boolean>) {
    if (process.env.ARENA_EXAM_DIAGNOSTICS !== 'true' || !this.diagnostics) return;
    const samples = this.diagnosticSamples.get(event) ?? [];
    samples.push(values);
    this.diagnosticSamples.set(event, samples);
    if (!this.diagnosticTimer) {
      this.diagnosticTimer = setTimeout(() => this.flushDiagnostics(), 60_000);
      this.diagnosticTimer.unref();
    }
    if (samples.length >= 2048) this.flushDiagnostics();
  }

  flushDiagnostics() {
    if (this.diagnosticTimer) clearTimeout(this.diagnosticTimer);
    this.diagnosticTimer = undefined;
    for (const [event, samples] of this.diagnosticSamples) {
      if (!samples.length) continue;
      const numericKeys = [...new Set(samples.flatMap((sample) => Object.entries(sample).filter(([, value]) => typeof value === 'number').map(([key]) => key)))];
      const percentile = (key: string, p: number) => {
        const values = samples.map((sample) => sample[key]).filter((value): value is number => typeof value === 'number').sort((a, b) => a - b);
        return values.length ? Number(values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]!.toFixed(2)) : null;
      };
      const outcomes: Record<string, number> = {};
      for (const sample of samples) {
        const outcome = String(sample.outcome ?? 'ok');
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      }
      this.diagnostics?.warn({ event, samples: samples.length, outcomes, timings_ms: Object.fromEntries(numericKeys.map((key) => [key, { p50: percentile(key, 0.5), p95: percentile(key, 0.95), p99: percentile(key, 0.99), max: percentile(key, 1) }])) }, 'exam endpoint diagnostic window');
      this.diagnosticSamples.set(event, []);
    }
  }

  async list(studentId: number) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT e.id,e.name,e.grade,e.duration_minutes,e.session_number,e.starts_at,e.ends_at,e.academic_year,e.semester,m.type follow_up_type,
      a.status attempt_status, ((a.status='IN_PROGRESS' AND a.expires_at>UTC_TIMESTAMP(3)) OR (a.id IS NULL AND e.status='ACTIVE' AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at AND (NOT EXISTS (SELECT 1 FROM exam_target_classes all_tc WHERE all_tc.exam_id=e.id) OR EXISTS (SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id=e.id AND tc.portal_class_id=s.portal_class_id)) AND (NOT EXISTS(SELECT 1 FROM exam_target_students all_ts WHERE all_ts.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id AND ts.student_id=s.id)))) can_start
      FROM students s JOIN exams e ON e.grade=s.grade_snapshot LEFT JOIN exam_attempts a ON a.student_id=s.id AND a.exam_id=e.id LEFT JOIN exam_follow_up_meta m ON m.exam_id=e.id
      WHERE s.id=? AND s.is_active=1 AND s.cbt_status='ACTIVE' AND ((e.status='ACTIVE' AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at
      AND (NOT EXISTS (SELECT 1 FROM exam_target_classes all_tc WHERE all_tc.exam_id=e.id) OR EXISTS (SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id=e.id AND tc.portal_class_id=s.portal_class_id))
      AND (NOT EXISTS(SELECT 1 FROM exam_target_students all_ts WHERE all_ts.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id AND ts.student_id=s.id))) OR a.id IS NOT NULL) ORDER BY e.starts_at DESC,e.id`, [studentId]);
    return rows.map((row) => ({ id: Number(row.id), nama_ujian: row.name, tingkat: row.grade, durasi: Number(row.duration_minutes), sesi: Number(row.session_number), tanggal_mulai: row.starts_at, tanggal_selesai: row.ends_at, tahun_ajaran: row.academic_year, semester: row.semester, status_attempt: row.attempt_status, can_start: Boolean(row.can_start), is_special: Boolean(row.follow_up_type), special_type: row.follow_up_type ?? null,
      admission_ticket: !row.attempt_status && Boolean(row.can_start) ? this.admission?.ticket(studentId, Number(row.id), row.grade, { academic_year: row.academic_year, semester: row.semester, starts_at: row.starts_at, session_number: row.session_number }) : undefined }));
  }

  async start(studentId:number,examId:number,retry=0,receipt?:WaitingClaimReceipt):Promise<unknown>{
    try{return await this.startOnce(studentId,examId,receipt);}
    catch(error){
      const code=(error as {code?:string}).code;
      if(retry<5&&['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','ER_DUP_ENTRY'].includes(code??'')){
        const delay=Math.min(250,20*(2**retry))+Math.floor(Math.random()*25);
        await new Promise((resolve)=>setTimeout(resolve,delay));
        return this.start(studentId,examId,retry+1,receipt);
      }
      throw error;
    }
  }

  private async startOnce(studentId: number, examId: number, receipt?: WaitingClaimReceipt) {
    const startedAt = performance.now();
    // Keep the first consistent read outside the resume transaction. If resume
    // waits on an autosave's attempt lock, the transaction must not retain a
    // repeatable-read snapshot from before that save committed.
    //
    // Student + attempt existence are read in one round-trip. Each call to
    // pool.execute() waits for a free pooled connection, so two separate reads
    // doubled the pool queue time under a start spike (measured ~0.5s + ~0.6s
    // per student at 1015 concurrent starts). The LEFT JOIN keeps the read
    // non-locking: `uq_arena_attempt_student_exam` makes the join at most one row.
    //
    // A locking read for an absent (student_id, exam_id) pair takes a gap lock
    // under InnoDB's default isolation. Many simultaneous starts on one exam
    // can then deadlock while inserting adjacent keys in the unique index. That
    // is why only the non-locking existence check happens here; the row itself
    // is locked later, inside the transaction, when it actually exists.
    //
    // The same round-trip also fetches the exam's admission fields (LEFT JOIN on
    // the exam primary key; the bound exam id matches at most one row) so the
    // Redis grade gate below can run before any pooled connection is acquired.
    const [students] = await this.pool.execute<RowDataPacket[]>(
      `SELECT s.id,s.portal_class_id,s.nisn,s.name_snapshot,s.class_snapshot,s.grade_snapshot,s.academic_year_snapshot,a.id attempt_id,
        e.id gate_exam_id,
        (e.status='ACTIVE' AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at AND e.grade=s.grade_snapshot
          AND (NOT EXISTS(SELECT 1 FROM exam_target_classes all_tc WHERE all_tc.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id=e.id AND tc.portal_class_id=s.portal_class_id))
          AND (NOT EXISTS(SELECT 1 FROM exam_target_students all_ts WHERE all_ts.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id AND ts.student_id=s.id))) exam_open,
        e.academic_year,e.semester,e.starts_at,e.session_number
       FROM students s LEFT JOIN exam_attempts a ON a.student_id=s.id AND a.exam_id=?
       LEFT JOIN exams e ON e.id=? WHERE s.id=? AND s.is_active=1 AND s.cbt_status='ACTIVE' LIMIT 1`,
      [examId, examId, studentId],
    );
    const student = students[0];
    if (!student) throw Object.assign(new Error('Siswa tidak ditemukan atau tidak aktif'), { statusCode: 403 });
    const hasExistingAttempt = Boolean(student.attempt_id);
    if (!hasExistingAttempt && student.gate_exam_id != null && Number(student.exam_open)) {
      // Gate antrean tingkat (Redis) berjalan DI LUAR transaksi database, hanya
      // saat ujian sudah memang terbuka untuk siswa ini (status, jendela waktu,
      // dan target sudah lolos di query preflight). Selama gate berada di dalam
      // transaksi, setiap start menahan koneksi pool MySQL selama latensi Redis,
      // dan ratusan siswa yang masih menunggu giliran mengantre pool hanya untuk
      // lalu ditolak 425. Di sini siswa yang belum dibuka tingkatnya tidak pernah
      // menyentuh pool MySQL, dan transaksi MySQL berhenti memegang latensi Redis.
      await this.admission?.assertCanStart(
        { academic_year: student.academic_year, semester: student.semester, starts_at: student.starts_at, session_number: student.session_number },
        student.grade_snapshot,
      );
    }
    if (!hasExistingAttempt) {
      // Warm-up cache sumber soal untuk SEMUA attempt baru (bukan hanya gate),
      // di luar transaksi: query `questions`, Redis GET/SET, dan parsing JSON
      // 40 soal tidak lagi memperpanjang waktu koneksi ditahan. Transaksi tetap
      // memanggil loader (akan jadi cache hit) supaya validasi "Soal ujian belum
      // tersedia" tetap berjalan di sana. Revision authoritative dibaca dari
      // MySQL (migrasi 015); kolom belum ada (deploy belum migrasi) => loader
      // bypass cache, aman.
      const [revisionRows] = await this.pool.execute<RowDataPacket[]>('SELECT source_revision FROM exams WHERE id=?', [examId]);
      await loadExamQuestionSource(examId, async () => {
        const [rows] = await this.pool.execute<RowDataPacket[]>(
          `SELECT id,question_type,question_text,option_a,option_b,option_c,option_d,option_e,correct_answer,points
           FROM questions WHERE exam_id=? AND status='ACTIVE' ORDER BY id`,
          [examId],
        );
        return rows;
      }, Number(revisionRows[0]?.source_revision));
    }
    const acquireStarted = performance.now();
    const connection = await this.pool.getConnection();
    const poolWaitMs = performance.now() - acquireStarted;
    let state: { attempt: RowDataPacket; exam: RowDataPacket; questions: RowDataPacket[]; answers: RowDataPacket[] } | undefined;
    try {
      await connection.beginTransaction();
      let attempt: RowDataPacket | undefined;
      if (hasExistingAttempt) {
        const [attemptRows] = await connection.execute<RowDataPacket[]>(`SELECT id,public_id,status,expires_at,question_order,option_mapping,(status='IN_PROGRESS' AND expires_at>UTC_TIMESTAMP(3)) can_resume FROM exam_attempts WHERE student_id=? AND exam_id=? FOR UPDATE`, [studentId, examId]);
        attempt = attemptRows[0];
      }
      if (attempt && ['COMPLETED', 'TERMINATED', 'EXPIRED'].includes(attempt.status)) throw Object.assign(new Error('Ujian ini tidak dapat dilanjutkan'), { statusCode: 409 });
      const resuming = Boolean(attempt && Number(attempt.can_resume));
      // db_now ikut dibaca agar expires_at bisa dihitung tanpa query tambahan
      // setelah INSERT (jam tetap mengikuti database, bukan jam aplikasi).
      const [examRows] = resuming
        ? await connection.execute<RowDataPacket[]>('SELECT e.*,UTC_TIMESTAMP(3) db_now FROM exams e WHERE e.id=?', [examId])
        : await connection.execute<RowDataPacket[]>(`SELECT e.*,UTC_TIMESTAMP(3) db_now FROM exams e WHERE e.id=? AND e.status='ACTIVE' AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at
          AND e.grade=? AND (NOT EXISTS(SELECT 1 FROM exam_target_classes all_tc WHERE all_tc.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id=e.id AND tc.portal_class_id=?))
          AND (NOT EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id AND ts.student_id=?))`, [examId, student.grade_snapshot, student.portal_class_id, studentId]);
      const exam = examRows[0];
      if (!exam) throw Object.assign(new Error('Ujian tidak tersedia untuk siswa ini'), { statusCode: 403 });
      // Sesi baru: seluruh state (soal + jawaban) sudah diketahui dari hasil INSERT,
      // jadi tidak perlu SELECT ulang. Memangkas 2 round-trip per siswa, penting saat
      // ratusan siswa menekan "Mulai" pada detik yang sama.
      let createdQuestions: RowDataPacket[] | undefined;
      if (!attempt) {
        // Gate antrean sudah dievaluasi sebelum transaksi (lihat di atas).
        const source = await loadExamQuestionSource(examId, async () => {
          const [rows] = await connection.execute<RowDataPacket[]>('SELECT id,question_type,question_text,option_a,option_b,option_c,option_d,option_e,correct_answer,points FROM questions WHERE exam_id=? AND status=\'ACTIVE\' ORDER BY id', [examId]);
          return rows;
        }, Number((exam as { source_revision?: unknown }).source_revision));
        if (!source.length) throw Object.assign(new Error('Soal ujian belum tersedia'), { statusCode: 409 });
        const seed = createHash('sha256').update(`${studentId}:${examId}:${randomBytes(16).toString('hex')}`).digest('hex');
        const orderedIds = shuffle(source.map((q) => Number(q.id)), seed);
        const mapping: Record<string, string[]> = {};
        for (const questionId of orderedIds) mapping[String(questionId)] = shuffle(options, `${seed}:${questionId}`);
        const publicId = ulid();
        const fullEnd = new Date(exam.db_now as string | Date).getTime() + Number(exam.duration_minutes) * 60_000;
        const expiresAt = new Date(receipt ? fullEnd : Math.min(fullEnd,new Date(exam.ends_at as string | Date).getTime()));
        const [inserted] = await connection.execute<ResultSetHeader>(`INSERT INTO exam_attempts(public_id,student_id,exam_id,status,started_at,expires_at,question_order,option_mapping)
          VALUES(?,?,?,'IN_PROGRESS',UTC_TIMESTAMP(3),${receipt ? 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MINUTE)' : 'LEAST(DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MINUTE),?)'},?,?)`, [publicId, studentId, examId, exam.duration_minutes, ...(receipt ? [] : [exam.ends_at]), JSON.stringify(orderedIds), JSON.stringify(mapping)]);
        attempt = { id: inserted.insertId, public_id: publicId, status: 'IN_PROGRESS', expires_at: expiresAt, question_order: JSON.stringify(orderedIds), option_mapping: JSON.stringify(mapping) } as unknown as RowDataPacket;
        const sourceById = new Map(source.map((question) => [Number(question.id), question]));
        const snapshotRows: unknown[][] = [];
        const synthesized: RowDataPacket[] = [];
        for (const questionId of orderedIds) {
          const question = sourceById.get(questionId)!;
          const letterMap = mapping[String(questionId)]!;
          const optionsMapped = Object.fromEntries(letterMap.map((letter, index) => [letter.toLowerCase(), question[`option_${options[index]!.toLowerCase()}`]]));
          const correct = String((question as RowDataPacket).correct_answer ?? '').split(',').map((letter) => letter.trim().toUpperCase()).filter(Boolean).map((letter) => letterMap[options.indexOf(letter)]).filter(Boolean).sort().join(',');
          snapshotRows.push([attempt.id, questionId, question.question_type, question.question_text, optionsMapped.a ?? null, optionsMapped.b ?? null, optionsMapped.c ?? null, optionsMapped.d ?? null, optionsMapped.e ?? null, correct, JSON.stringify(letterMap), question.points]);
          synthesized.push({ id: questionId, question_type: question.question_type, question_text: question.question_text, option_a: optionsMapped.a ?? null, option_b: optionsMapped.b ?? null, option_c: optionsMapped.c ?? null, option_d: optionsMapped.d ?? null, option_e: optionsMapped.e ?? null, points: question.points } as unknown as RowDataPacket);
        }
        await connection.query('INSERT INTO attempt_questions(attempt_id,question_id,question_type,question_text,option_a,option_b,option_c,option_d,option_e,correct_answer,option_mapping,points) VALUES ?', [snapshotRows]);
        createdQuestions = synthesized;
      }
      if (resuming) {
        const [stillActive] = await connection.execute<RowDataPacket[]>(`SELECT 1 active FROM exam_attempts WHERE id=? AND status='IN_PROGRESS' AND expires_at>UTC_TIMESTAMP(3)`, [attempt.id]);
        if (!stillActive.length) throw Object.assign(new Error('Waktu ujian sudah habis. Jawaban yang tersimpan tetap aman.'), { statusCode: 409 });
      }
      const activeAttempt = attempt;
      if (!activeAttempt) throw Object.assign(new Error('Gagal membuat sesi ujian'), { statusCode: 503 });
      let questions: RowDataPacket[];
      let answers: RowDataPacket[];
      if (createdQuestions) {
        questions = createdQuestions;
        answers = [];
      } else {
        [questions] = await connection.execute<RowDataPacket[]>('SELECT question_id id,question_type,question_text,option_a,option_b,option_c,option_d,option_e,points FROM attempt_questions WHERE attempt_id=?', [activeAttempt.id]);
        [answers] = await connection.execute<RowDataPacket[]>('SELECT v.question_id,a.answer,COALESCE(a.is_flagged,0) is_flagged,COALESCE(v.revision,0) revision FROM answer_write_versions v LEFT JOIN student_answers a ON a.attempt_id=v.attempt_id AND a.question_id=v.question_id WHERE v.attempt_id=?', [activeAttempt.id]);
      }
      if (receipt) {
        const [claims] = await connection.execute<RowDataPacket[]>('SELECT token_hash FROM exam_waiting_claims WHERE exam_id=? AND student_id=? FOR UPDATE',[examId,studentId]);
        if (claims[0] && claims[0].token_hash!==receipt.tokenHash) throw Object.assign(new Error('Token sesi ujian berubah. Pulihkan sesi dari jadwal.'),{statusCode:409});
        if (!claims[0]) await connection.execute("INSERT INTO exam_waiting_claims(exam_id,student_id,attempt_id,token_hash,queue_sequence,state) VALUES(?,?,?,?,?,'IN_EXAM')",[examId,studentId,activeAttempt.id,receipt.tokenHash,receipt.sequence]);
      }
      await connection.commit();
      state = { attempt: activeAttempt, exam, questions, answers };
    } catch (error) {
      try { await connection.rollback(); } catch { /* no active transaction */ }
      throw error;
    } finally { connection.release(); }
    const { attempt, exam, questions, answers } = state!;
    // Count only after COMMIT. SADD is idempotent on retries/resume, including
    // a retry after the DB committed but the Redis acknowledgement was lost.
    try {
      await this.admission?.started({ academic_year: exam.academic_year, semester: exam.semester, starts_at: exam.starts_at, session_number: exam.session_number }, student.grade_snapshot, studentId);
    } catch (error) {
      // A Redis interruption must not lock a student out of an existing attempt.
      if (!hasExistingAttempt || (error as { statusCode?: number }).statusCode !== 503) throw error;
      this.recordDiagnostic('exam_admission', { outcome: 'resume_counter_deferred' });
    }
    const byId = new Map(questions.map((q) => [Number(q.id), q]));
    const mapping = jsonValue<Record<string, string[]>>(attempt.option_mapping);
    const ordered = jsonValue<number[]>(attempt.question_order).map((id) => {
      const q = byId.get(Number(id));
      if (!q) return null;
      const type = q.question_type as string;
      const choices = type === 'SHORT_ANSWER' ? [] : (mapping[String(id)] ?? options).map((key) => ({ key, text: q[`option_${key.toLowerCase()}`] })).filter((choice) => choice.text !== null && choice.text !== '');
      return { id: Number(q.id), tipe: type, pertanyaan: q.question_text, opsi: choices, poin: Number(q.points) };
    }).filter(Boolean);
    this.recordDiagnostic('exam_start', { resumed: hasExistingAttempt, question_count: ordered.length, pool_wait_ms: Number(poolWaitMs.toFixed(2)), total_ms: Number((performance.now() - startedAt).toFixed(2)) });
    return { attempt_id: attempt.public_id, exam: { id: Number(exam.id), nama_ujian: exam.name }, expires_at: attempt.expires_at, server_time: new Date().toISOString(), soal: ordered, jawaban: answers.map((a) => ({ question_id: Number(a.question_id), answer: a.answer, is_flagged: Boolean(a.is_flagged), revision: Number(a.revision) })) };
  }

  async heartbeat(studentId: number, examId: number) {
    const started = performance.now();
    let acquireMs = 0;
    let queryMs = 0;
    const acquireStarted = performance.now();
    const connection = await this.pool.getConnection();
    acquireMs = performance.now() - acquireStarted;
    try {
      const queryStarted = performance.now();
      await connection.execute(
        `INSERT INTO attempt_connections(attempt_id,last_seen_at)
         SELECT id,UTC_TIMESTAMP(3) FROM exam_attempts
         WHERE student_id=? AND exam_id=? AND status='IN_PROGRESS' AND expires_at>UTC_TIMESTAMP(3)
         ON DUPLICATE KEY UPDATE last_seen_at=IF(attempt_connections.last_seen_at<UTC_TIMESTAMP(3)-INTERVAL 40 SECOND,UTC_TIMESTAMP(3),attempt_connections.last_seen_at)`,
        [studentId, examId],
      );
      queryMs = performance.now() - queryStarted;
    } finally {
      connection.release();
      this.recordDiagnostic('exam_heartbeat', { acquire_ms: Number(acquireMs.toFixed(2)), query_ms: Number(queryMs.toFixed(2)), total_ms: Number((performance.now() - started).toFixed(2)) });
    }
    return { server_time: new Date().toISOString() };
  }

  async saveAnswersBatch(claims: Claims, examId: number, input: { attempt_id: string; answers: { question_id: number; answer: string | null; is_flagged: boolean; base_revision: number; mutation_id: string }[] }) {
    const ids = input.answers.map((answer) => answer.question_id);
    if (!ids.length || ids.length > 40 || new Set(ids).size !== ids.length) throw Object.assign(new Error('Batch jawaban tidak valid'), { statusCode: 422 });
    const started = performance.now();
    const connection = await this.pool.getConnection();
    const poolWaitMs = performance.now() - started;
    try {
      await connection.beginTransaction();
      const [attempts] = await connection.execute<RowDataPacket[]>('SELECT id,public_id,status,expires_at,(expires_at<=UTC_TIMESTAMP(3)) expired FROM exam_attempts WHERE student_id=? AND exam_id=? FOR UPDATE', [claims.sub, examId]);
      const attempt = attempts[0];
      if (!attempt) throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 });
      if (attempt.public_id !== input.attempt_id) throw Object.assign(new Error('Sesi ujian berubah; muat ulang halaman'), { statusCode: 409 });
      const marks = ids.map(() => '?').join(',');
      const [rows] = await connection.query<RowDataPacket[]>(`SELECT q.question_id,q.question_type,
        (q.option_a IS NOT NULL AND q.option_a<>'') option_a_available,
        (q.option_b IS NOT NULL AND q.option_b<>'') option_b_available,
        (q.option_c IS NOT NULL AND q.option_c<>'') option_c_available,
        (q.option_d IS NOT NULL AND q.option_d<>'') option_d_available,
        (q.option_e IS NOT NULL AND q.option_e<>'') option_e_available,
        v.revision,v.mutation_id,a.answer,a.is_flagged
        FROM attempt_questions q LEFT JOIN answer_write_versions v ON v.attempt_id=q.attempt_id AND v.question_id=q.question_id
        LEFT JOIN student_answers a ON a.attempt_id=q.attempt_id AND a.question_id=q.question_id
        WHERE q.attempt_id=? AND q.question_id IN (${marks})`, [attempt.id, ...ids]);
      const byId = new Map(rows.map((row) => [Number(row.question_id), row]));
      const updates: { questionId: number; answer: string | null; flagged: boolean; revision: number; mutationId: string }[] = [];
      const revisions: Record<number, number> = {};
      for (const item of input.answers) {
        const row = byId.get(item.question_id);
        if (!row) throw Object.assign(new Error('Soal tidak ditemukan'), { statusCode: 404 });
        let answer = item.answer?.trim() || null;
        if (answer !== null) {
          if (row.question_type === 'SHORT_ANSWER') {
            if (answer.length > 500) throw Object.assign(new Error('Jawaban terlalu panjang'), { statusCode: 422 });
          } else {
            const letters = [...new Set(answer.toUpperCase().split(',').map((part) => part.trim()).filter(Boolean))].sort();
            if (!letters.length || (row.question_type === 'MULTIPLE_CHOICE' && letters.length !== 1) || letters.some((letter) => !['A','B','C','D','E'].includes(letter) || !row[`option_${letter.toLowerCase()}_available`])) throw Object.assign(new Error('Pilihan jawaban tidak valid'), { statusCode: 422 });
            answer = letters.join(',');
          }
        }
        const revision = row.revision === null ? 0 : Number(row.revision);
        if (row.mutation_id === item.mutation_id) {
          if (row.answer !== answer || Boolean(row.is_flagged) !== item.is_flagged) throw Object.assign(new Error('ID mutation sudah digunakan untuk payload lain'), { statusCode: 409 });
          revisions[item.question_id] = revision;
          continue;
        }
        if (attempt.status !== 'IN_PROGRESS' || Number(attempt.expired)) throw Object.assign(new Error('Ujian sudah tidak aktif'), { statusCode: 409 });
        if (revision !== item.base_revision) throw Object.assign(new Error('Versi jawaban berubah di tab lain'), { statusCode: 409 });
        const nextRevision = revision + 1;
        updates.push({ questionId: item.question_id, answer, flagged: item.is_flagged, revision: nextRevision, mutationId: item.mutation_id });
        revisions[item.question_id] = nextRevision;
      }
      if (updates.length) {
        const answerValues = updates.map((item) => [attempt.id, item.questionId, item.answer, Number(item.flagged)]);
        await connection.query('INSERT INTO student_answers(attempt_id,question_id,answer,is_flagged,answered_at) VALUES ? ON DUPLICATE KEY UPDATE answer=VALUES(answer),is_flagged=VALUES(is_flagged),answered_at=VALUES(answered_at)', [answerValues.map((row) => [...row, new Date()])]);
        const versionValues = updates.map((item) => [attempt.id, item.questionId, item.revision, item.mutationId]);
        await connection.query('INSERT INTO answer_write_versions(attempt_id,question_id,revision,mutation_id) VALUES ? ON DUPLICATE KEY UPDATE revision=VALUES(revision),mutation_id=VALUES(mutation_id)', [versionValues]);
      }
      await connection.commit();
      this.recordDiagnostic('exam_batch', { outcome: 'saved', batch_size: ids.length, pool_wait_ms: Number(poolWaitMs.toFixed(2)), total_ms: Number((performance.now() - started).toFixed(2)) });
      return { revisions };
    } catch (error) {
      try { await connection.rollback(); } catch { /* no active transaction */ }
      this.recordDiagnostic('exam_batch', { outcome: 'error', batch_size: ids.length, pool_wait_ms: Number(poolWaitMs.toFixed(2)), total_ms: Number((performance.now() - started).toFixed(2)) });
      throw error;
    } finally { connection.release(); }
  }

  async saveAnswer(claims:Claims,examId:number,questionId:number,input:{answer:string|null;is_flagged:boolean;attempt_id:string;base_revision:number;mutation_id:string},retry=0):Promise<unknown>{try{return await this.saveAnswerOnce(claims,examId,questionId,input);}catch(error){const code=(error as {code?:string}).code;if(retry<2&&['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(code??'')){await new Promise((resolve)=>setTimeout(resolve,10+Math.floor(Math.random()*30)));return this.saveAnswer(claims,examId,questionId,input,retry+1);}throw error;}}

  private async saveAnswerOnce(claims: Claims, examId: number, questionId: number, input: { answer: string | null; is_flagged: boolean; attempt_id: string; base_revision: number; mutation_id: string }) {
    if (input.base_revision < 0 || !/^[A-Za-z0-9_-]{16,100}$/.test(input.mutation_id)) throw Object.assign(new Error('Versi penyimpanan tidak valid'), { statusCode: 422 });
    const started = performance.now();
    const timings: Record<string, number> = {};
    const mark = (name: string, from: number) => { timings[name] = Number((performance.now() - from).toFixed(2)); };
    const acquireStarted = performance.now();
    const connection = await this.pool.getConnection();
    mark('pool_wait_ms', acquireStarted);
    try {
      let phase = performance.now();
      await connection.beginTransaction();
      mark('begin_ms', phase);
      try {
        // Use a single unified query with FOR SHARE OF ea.
        // This grants a Shared Lock (S-lock) on exam_attempts, allowing concurrent
        // autosaves for different questions on the same attempt without row-lock serialization,
        // while blocking submit (which requires an exclusive X-lock via FOR UPDATE) until
        // active autosaves finish. It also cuts round-trips from 2 SELECTs down to 1.
        phase = performance.now();
        const [stateRows] = await connection.execute<RowDataPacket[]>(
          `SELECT ea.id AS attempt_id, ea.public_id, ea.status AS attempt_status, ea.expires_at, (ea.expires_at <= UTC_TIMESTAMP(3)) AS expired,
                  q.question_type,
                  (q.option_a IS NOT NULL AND q.option_a <> '') AS option_a_available,
                  (q.option_b IS NOT NULL AND q.option_b <> '') AS option_b_available,
                  (q.option_c IS NOT NULL AND q.option_c <> '') AS option_c_available,
                  (q.option_d IS NOT NULL AND q.option_d <> '') AS option_d_available,
                  (q.option_e IS NOT NULL AND q.option_e <> '') AS option_e_available,
                  v.revision, v.mutation_id,
                  a.id AS answer_id, a.answer, a.is_flagged
           FROM exam_attempts ea
           LEFT JOIN attempt_questions q ON q.attempt_id = ea.id AND q.question_id = ?
           LEFT JOIN answer_write_versions v ON v.attempt_id = ea.id AND v.question_id = q.question_id
           LEFT JOIN student_answers a ON a.attempt_id = ea.id AND a.question_id = q.question_id
           WHERE ea.student_id = ? AND ea.exam_id = ?
           FOR SHARE OF ea`,
          [questionId, claims.sub, examId],
        );
        mark('unified_state_query_ms', phase);
        const current = stateRows[0];
        if (!current) throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 });
        if (current.public_id !== input.attempt_id) throw Object.assign(new Error('Sesi ujian berubah; muat ulang halaman'), { statusCode: 409 });
        if (!current.question_type) throw Object.assign(new Error('Soal tidak ditemukan'), { statusCode: 404 });
        let answer = input.answer?.trim() || null;
        if (answer !== null) {
          if (current.question_type === 'SHORT_ANSWER') {
            if (answer.length > 500) throw Object.assign(new Error('Jawaban terlalu panjang'), { statusCode: 422 });
          } else {
            const letters = [...new Set(answer.toUpperCase().split(',').filter(Boolean))].sort();
            if (!letters.length || (current.question_type === 'MULTIPLE_CHOICE' && letters.length !== 1) || letters.some((letter) => !['A', 'B', 'C', 'D', 'E'].includes(letter) || !current[`option_${letter.toLowerCase()}_available`])) throw Object.assign(new Error('Pilihan jawaban tidak valid'), { statusCode: 422 });
            answer = letters.join(',');
          }
        }
        const revision = current.revision === null ? 0 : Number(current.revision);
        if (current.mutation_id === input.mutation_id) {
          if (current.answer !== answer || Boolean(current.is_flagged) !== input.is_flagged) throw Object.assign(new Error('ID mutation sudah digunakan untuk payload lain'), { statusCode: 409 });
          phase = performance.now();
          await connection.commit();
          mark('commit_ms', phase);
          this.recordDiagnostic('exam_autosave', { outcome: 'duplicate', ...timings, total_ms: Number((performance.now() - started).toFixed(2)) });
          return { question_id: questionId, revision, duplicate: true };
        }
        if (current.attempt_status !== 'IN_PROGRESS' || Number(current.expired)) throw Object.assign(new Error('Ujian sudah tidak aktif'), { statusCode: 409 });
        if (revision !== input.base_revision) throw Object.assign(new Error('Versi jawaban berubah di tab lain'), { statusCode: 409 });
        phase = performance.now();
        if (current.answer_id !== null) {
          if (current.answer !== answer || Boolean(current.is_flagged) !== input.is_flagged) await connection.execute('UPDATE student_answers SET answer=?,is_flagged=?,answered_at=UTC_TIMESTAMP(3) WHERE id=?', [answer, Number(input.is_flagged), current.answer_id]);
        } else if (answer !== null || input.is_flagged) await connection.execute('INSERT INTO student_answers(attempt_id,question_id,answer,is_flagged,answered_at) VALUES(?,?,?,?,UTC_TIMESTAMP(3))', [current.attempt_id, questionId, answer, Number(input.is_flagged)]);
        if (current.revision === null) await connection.execute('INSERT INTO answer_write_versions(attempt_id,question_id,revision,mutation_id) VALUES(?,?,1,?)', [current.attempt_id, questionId, input.mutation_id]);
        else await connection.execute('UPDATE answer_write_versions SET revision=?,mutation_id=? WHERE attempt_id=? AND question_id=?', [revision + 1, input.mutation_id, current.attempt_id, questionId]);
        mark('answer_writes_ms', phase);
        phase = performance.now();
        await connection.commit();
        mark('commit_ms', phase);
        this.recordDiagnostic('exam_autosave', { outcome: 'saved', ...timings, total_ms: Number((performance.now() - started).toFixed(2)) });
        return { question_id: questionId, answer, is_flagged: input.is_flagged, revision: revision + 1, saved_at: new Date().toISOString() };
      } catch (error) {
        const code = (error as { code?: string }).code ?? 'unknown';
        phase = performance.now();
        try { await connection.rollback(); } catch { /* no active transaction */ }
        mark('rollback_ms', phase);
        this.recordDiagnostic('exam_autosave', { outcome: 'error', error_code: code, ...timings, total_ms: Number((performance.now() - started).toFixed(2)) });
        throw error;
      }
    } finally { connection.release(); }
  }
}

import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

const violationTypes = new Set(['TAB_HIDDEN','WINDOW_BLUR','FULLSCREEN_EXIT','SCREENSHOT_ATTEMPT','COPY_ATTEMPT','PASTE_ATTEMPT','CUT_ATTEMPT','CONTEXT_MENU_ATTEMPT','DEVTOOLS_SHORTCUT','BROWSER_SHORTCUT','SPLIT_SCREEN_SUSPECTED','MULTI_TAB','TEXT_SELECTION','OTHER']);
// Counted types decide automatic termination. WINDOW_BLUR / MULTI_TAB / SPLIT_SCREEN_SUSPECTED
// are counted since session 2026: opening a second window/tab, mirroring to another device via
// a focused second app, or snapping the exam window into a split layout are all cheat signals.
const thresholdTypes = new Set(['TAB_HIDDEN','WINDOW_BLUR','FULLSCREEN_EXIT','SCREENSHOT_ATTEMPT','COPY_ATTEMPT','MULTI_TAB','SPLIT_SCREEN_SUSPECTED']);
// Low-confidence signals (e.g. long-press text selection on Android, blocked context menu)
// are logged for proctors, but every ROLLUP_SIZE events of the same type in one attempt
// roll up into a single counted violation so persistent offenders still get terminated.
const rollupTypes = new Set(['TEXT_SELECTION','CONTEXT_MENU_ATTEMPT']);
const ROLLUP_SIZE = 3;

// Violation policy (threshold 2|3 + termination action) is configurable by admins through
// cbt_settings.violation_termination_threshold / violation_action. Cached for 60 s so
// concurrent violation reports never generate extra settings queries under exam load.
const DEFAULT_VIOLATION_THRESHOLD = 3;
const DEFAULT_VIOLATION_ACTION = 'AUTO_SUBMIT';
type ViolationAction = 'AUTO_SUBMIT' | 'LOCK';
let policyCache: { threshold: number; action: ViolationAction; expiresAt: number } | null = null;
export function invalidateViolationThresholdCache() { policyCache = null; }
export async function readViolationThreshold(connection: PoolConnection): Promise<number> {
  return (await readViolationPolicy(connection)).threshold;
}
async function readViolationPolicy(connection: PoolConnection): Promise<{ threshold: number; action: ViolationAction }> {
  if (policyCache && Date.now() < policyCache.expiresAt) return policyCache;
  let threshold = DEFAULT_VIOLATION_THRESHOLD, action: ViolationAction = DEFAULT_VIOLATION_ACTION;
  try {
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT key_name,value FROM cbt_settings WHERE key_name IN ('violation_termination_threshold','violation_action')");
    for (const row of rows) {
      if (row.key_name === 'violation_termination_threshold' && Number(row.value) === 2) threshold = 2;
      else if (row.key_name === 'violation_action' && row.value === 'LOCK') action = 'LOCK';
    }
  } catch { /* missing table or transient failure; keep safe defaults */ }
  policyCache = { threshold, action, expiresAt: Date.now() + 60_000 };
  return policyCache;
}

/** Pool-level wrapper so admin routes can share the same cached policy. */
export async function getViolationPolicy(pool: Pool): Promise<{ threshold: number; action: ViolationAction }> {
  const connection = await pool.getConnection();
  try {
    return await readViolationPolicy(connection);
  } finally {
    connection.release();
  }
}

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

const examMetaCache = new Map<number, { isRemedial: boolean; scoreCap: number | null; followUpType: string | null; expiresAt: number }>();
async function getExamMeta(connection: Pool | import('mysql2/promise').PoolConnection, examId: number): Promise<{ isRemedial: boolean; scoreCap: number | null; followUpType: string | null }> {
  const cached = examMetaCache.get(examId);
  if (cached && Date.now() < cached.expiresAt) return { isRemedial: cached.isRemedial, scoreCap: cached.scoreCap, followUpType: cached.followUpType };
  const [followUps] = await connection.execute<RowDataPacket[]>('SELECT m.type,e.grade FROM exam_follow_up_meta m JOIN exams e ON e.id=m.exam_id WHERE m.exam_id=? LIMIT 1', [examId]);
  let isRemedial = false;
  let scoreCap: number | null = null;
  const followUpType = (followUps[0]?.type as string | undefined) ?? null;
  if (followUpType === 'REMEDIAL') {
    isRemedial = true;
    const capKey = `remedial_score_cap_${String(followUps[0]?.grade).toUpperCase().trim()}`;
    const [settings] = await connection.execute<RowDataPacket[]>('SELECT value FROM cbt_settings WHERE key_name=? LIMIT 1', [capKey]);
    scoreCap = settings[0] ? Number(settings[0].value) : 75;
  }
  examMetaCache.set(examId, { isRemedial, scoreCap, followUpType, expiresAt: Date.now() + 60_000 });
  return { isRemedial, scoreCap, followUpType };
}

export class ScoringService {
  private readonly submitInFlight = new Map<string, Promise<unknown>>();
  constructor(private readonly pool: Pool) {}

  async submit(studentId: number, examId: number, finalizeOnly = false): Promise<unknown> {
    const flightKey = `${studentId}:${examId}:${finalizeOnly}`;
    const inFlight = this.submitInFlight.get(flightKey);
    if (inFlight) return await inFlight;
    const task = this.submitWithRetry(studentId, examId, finalizeOnly, 0);
    this.submitInFlight.set(flightKey, task);
    try {
      return await task;
    } finally {
      if (this.submitInFlight.get(flightKey) === task) {
        this.submitInFlight.delete(flightKey);
      }
    }
  }

  private async submitWithRetry(studentId: number, examId: number, finalizeOnly = false, retry = 0): Promise<unknown> {
    try {
      return await this.submitOnce(studentId, examId, finalizeOnly);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (retry < 2 && ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(code ?? '')) {
        await new Promise((resolve) => setTimeout(resolve, 10 + Math.floor(Math.random() * 30)));
        return this.submitWithRetry(studentId, examId, finalizeOnly, retry + 1);
      }
      throw error;
    }
  }

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
        const { isRemedial, scoreCap, followUpType } = await getExamMeta(connection, examId);
        await connection.commit();
        return this.format(existing, isRemedial, scoreCap, followUpType);
      }
      if (finalizeOnly && attempt.status === 'IN_PROGRESS' && !Number(attempt.expired)) throw Object.assign(new Error('Ujian masih aktif'), { statusCode: 409 });
      if (!['IN_PROGRESS', 'TERMINATED'].includes(attempt.status)) throw Object.assign(new Error('Ujian tidak dapat disubmit'), { statusCode: 409 });
      // Optimized query: Only select necessary scoring columns and calculate option_count in SQL,
      // avoiding transferring heavy option text strings (option_a..e) across the wire.
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT q.question_id,q.question_type,q.correct_answer,q.points,a.answer,
        ((q.option_a IS NOT NULL AND q.option_a<>'') + (q.option_b IS NOT NULL AND q.option_b<>'') + (q.option_c IS NOT NULL AND q.option_c<>'') + (q.option_d IS NOT NULL AND q.option_d<>'') + (q.option_e IS NOT NULL AND q.option_e<>'')) option_count
        FROM attempt_questions q LEFT JOIN student_answers a ON a.attempt_id=q.attempt_id AND a.question_id=q.question_id WHERE q.attempt_id=?`, [attempt.id]);
      if (!rows.length) throw Object.assign(new Error('Snapshot soal tidak tersedia'), { statusCode: 409 });
      const totals = rows.reduce((result, row) => {
        const points = Number(row.points); result.maximum += points;
        if (row.answer === null) result.blank++;
        else {
          const available = Number(row.option_count ?? [row.option_a,row.option_b,row.option_c,row.option_d,row.option_e].filter((value) => String(value ?? '').trim() !== '').length);
          const score = fraction(row.question_type, row.correct_answer, row.answer, available);
          result.earned += points * score;
          if (score >= 1) result.correct++; else result.wrong++;
        }
        return result;
      }, { correct: 0, wrong: 0, blank: 0, earned: 0, maximum: 0 });
      let score = totals.maximum > 0 ? Math.round((totals.earned / totals.maximum * 100) * 100) / 100 : 0;
      const { isRemedial, scoreCap, followUpType } = await getExamMeta(connection, examId);
      if (isRemedial && scoreCap !== null && score > scoreCap) {
        score = Math.round(scoreCap * 100) / 100;
      }
      await connection.execute(`INSERT INTO exam_results(attempt_id,question_count,correct_count,wrong_count,blank_count,earned_points,maximum_points,score) VALUES(?,?,?,?,?,?,?,?)`, [attempt.id, rows.length, totals.correct, totals.wrong, totals.blank, totals.earned, totals.maximum, score]);
      await connection.execute("UPDATE exam_attempts SET status=IF(status='TERMINATED','TERMINATED',IF(expires_at<=UTC_TIMESTAMP(3),'EXPIRED','COMPLETED')),completed_at=UTC_TIMESTAMP(3) WHERE id=?", [attempt.id]);
      await connection.commit();
      return { jumlah_soal: rows.length, benar: totals.correct, salah: totals.wrong, kosong: totals.blank, total_poin: totals.earned, nilai: score, is_remedial: isRemedial, score_cap: scoreCap, follow_up_type: followUpType, status: 'selesai' };
    } catch (error) {
      try { await connection.rollback(); } catch { /* no active transaction */ }
      throw error;
    } finally { connection.release(); }
  }

  async review(studentId: number, examId: number) {
    const [attempts] = await this.pool.execute<RowDataPacket[]>('SELECT id,status,question_order FROM exam_attempts WHERE student_id=? AND exam_id=? LIMIT 1', [studentId, examId]);
    const attempt = attempts[0];
    if (!attempt) throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 });
    if (!['COMPLETED','EXPIRED'].includes(attempt.status)) throw Object.assign(new Error('Review hanya tersedia setelah ujian selesai'), { statusCode: 403 });
    const rawOrder=attempt.question_order;
    const parsedOrder=typeof rawOrder==='string'?JSON.parse(rawOrder):rawOrder;
    const order=Array.isArray(parsedOrder)?parsedOrder.map(Number).filter(Number.isSafeInteger):[];
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT q.question_id,q.question_text,q.question_type,q.correct_answer,q.option_a,q.option_b,q.option_c,q.option_d,q.option_e,a.answer FROM attempt_questions q LEFT JOIN student_answers a ON a.attempt_id=q.attempt_id AND a.question_id=q.question_id WHERE q.attempt_id=?', [attempt.id]);
    if (!rows.length) throw Object.assign(new Error('Data soal review belum tersedia. Hubungi petugas ujian.'), { statusCode: 404 });
    const rowByQuestion = new Map(rows.map((row) => [Number(row.question_id), row]));
    const orderedRows = order.length ? [...order.map((id) => rowByQuestion.get(id)).filter((row): row is RowDataPacket => Boolean(row)),...rows.filter((row) => !order.includes(Number(row.question_id)))] : rows;
    return { soal: orderedRows.map((row) => {
      const available = [row.option_a,row.option_b,row.option_c,row.option_d,row.option_e].filter((value) => String(value ?? '').trim() !== '').length;
      const score = row.answer === null ? 0 : fraction(row.question_type, row.correct_answer, row.answer, available);
      return { id: Number(row.question_id), pertanyaan: row.question_text, status: row.answer === null ? 'KOSONG' : score >= 1 ? 'BENAR' : score > 0 ? 'SEBAGIAN' : 'SALAH' };
    }) };
  }

  async recordViolation(studentId: number, examId: number, eventKey: string, type: string, metadata: { ip?: string; userAgent?: string; clientOccurredAt?: string | null; questionNo?: number } = {}) {
    let terminated = false;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>('SELECT id,status,violation_count FROM exam_attempts WHERE student_id=? AND exam_id=? FOR UPDATE', [studentId, examId]);
      const attempt = rows[0];
      if (!attempt) throw Object.assign(new Error('Sesi ujian tidak ditemukan'), { statusCode: 404 });
      if (attempt.status !== 'IN_PROGRESS') { const policy = await readViolationPolicy(connection); await connection.commit(); return { recorded: false, count: Number(attempt.violation_count), threshold: policy.threshold, action: policy.action, terminated: attempt.status === 'TERMINATED' }; }
      const recordedType = violationTypes.has(type) ? type : 'OTHER';
      const policy = await readViolationPolicy(connection);
      const questionNo = Number.isSafeInteger(metadata.questionNo) ? Math.min(2000, Math.max(0, Number(metadata.questionNo))) : null;
      const [result] = await connection.execute('INSERT IGNORE INTO violations(attempt_id,event_key,type,occurred_at,client_occurred_at,ip_address,user_agent,question_no,rolled_up) VALUES(?,?,?,UTC_TIMESTAMP(3),?,?,?,?,0)', [attempt.id, eventKey, recordedType, metadata.clientOccurredAt ? new Date(metadata.clientOccurredAt) : null, (metadata.ip ?? '').slice(0,45) || null, (metadata.userAgent ?? '').slice(0,500) || null, questionNo]);
      const inserted = (result as { affectedRows: number }).affectedRows > 0;
      let counted = inserted && thresholdTypes.has(recordedType);
      if (inserted && rollupTypes.has(recordedType)) {
        // Logged signal, but every ROLLUP_SIZE occurrences in one attempt become a
        // single counted violation. One indexed COUNT + one conditional UPDATE per
        // soft event; rate limiting keeps this well under exam load.
        const [pendingRows] = await connection.execute<RowDataPacket[]>("SELECT COUNT(*) pending FROM violations WHERE attempt_id=? AND type=? AND rolled_up=0", [attempt.id, recordedType]);
        if (Number((pendingRows[0] as { pending?: unknown } | undefined)?.pending ?? 0) >= ROLLUP_SIZE) {
          await connection.execute('UPDATE violations SET rolled_up=1 WHERE attempt_id=? AND type=? AND rolled_up=0', [attempt.id, recordedType]);
          counted = true;
        }
      }
      if (counted) await connection.execute('UPDATE exam_attempts SET violation_count=LEAST(255,violation_count+1),status=IF(violation_count+1>=?,\'TERMINATED\',status) WHERE id=?', [policy.threshold, attempt.id]);
      await connection.commit();
      const count = Number(attempt.violation_count) + Number(counted);
      terminated = counted && count >= policy.threshold;
      const outcome: { recorded: boolean; count: number; threshold: number; action: ViolationAction; terminated: boolean; hasil?: unknown } = { recorded: inserted, count, threshold: policy.threshold, action: policy.action, terminated };
      // Release the connection *before* calling submit so it can acquire its own
      // connection from the pool without risk of exhaustion when pool is small.
      connection.release();
      if (terminated) {
        if (policy.action === 'LOCK') {
          // LOCK policy: terminate without publishing results; the session stays
          // recoverable by an admin through the audited attempt reset.
          outcome.terminated = true;
        } else {
          outcome.hasil = await this.submit(studentId, examId, true);
        }
      }
      return outcome;
    } catch (error) {
      try { await connection.rollback(); } catch { /* no active transaction */ }
      throw error;
    } finally {
      // Guard: only release if submit path above did not already release it.
      // mysql2 pool connections ignore double-release, but be explicit.
      if (!terminated) connection.release();
    }
  }

  private format(row: RowDataPacket, isRemedial = false, scoreCap: number | null = null, followUpType: string | null = null) {
    return { jumlah_soal: Number(row.question_count), benar: Number(row.correct_count), salah: Number(row.wrong_count), kosong: Number(row.blank_count), total_poin: Number(row.earned_points), nilai: Number(row.score), is_remedial: isRemedial, score_cap: scoreCap, follow_up_type: followUpType, status: 'selesai' };
  }
}

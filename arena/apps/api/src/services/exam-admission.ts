import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';

export const admissionGrades = ['XII', 'XI', 'X'] as const;
export type AdmissionGrade = typeof admissionGrades[number];
export type AdmissionExam = { academic_year: unknown; semester: unknown; starts_at: unknown; session_number: unknown };
type Ticket = { studentId: number; examId: number; grade: AdmissionGrade; group: string; exp: number };

// All keys use one Redis hash tag, including when Redis Cluster is introduced.
// Counts are distinct students, shared across grade-specific exam packages.
export const admissionLua = `
redis.replicate_commands()
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local threshold = tonumber(redis.call('HGET', KEYS[1], 'threshold'))
if not threshold then
  threshold = tonumber(ARGV[3])
  redis.call('HSET', KEYS[1], 'threshold', threshold)
end
local maxWait = tonumber(redis.call('HGET', KEYS[1], 'max_wait_ms'))
if not maxWait or maxWait > tonumber(ARGV[7]) then
  maxWait = tonumber(ARGV[7])
  redis.call('HSET', KEYS[1], 'max_wait_ms', maxWait)
end
local stage = tonumber(redis.call('HGET', KEYS[1], 'stage') or '0')
local openedAt = tonumber(redis.call('HGET', KEYS[1], 'stage_started_at_ms'))
if not openedAt and ARGV[1] ~= 'peek' then openedAt = now end
if ARGV[1] == 'started' then redis.call('SADD', KEYS[tonumber(ARGV[2]) + 2], ARGV[4]) end
local counts = {redis.call('SCARD', KEYS[2]), redis.call('SCARD', KEYS[3]), redis.call('SCARD', KEYS[4])}
while stage < 2 do
  local timedOut = openedAt and now >= openedAt + maxWait
  if counts[stage + 1] < threshold and not timedOut then break end
  if timedOut then openedAt = openedAt + maxWait else openedAt = now end
  stage = stage + 1
end
if ARGV[1] == 'advance' and stage == tonumber(ARGV[6]) and stage < 2 then
  stage = stage + 1
  openedAt = now
end
redis.call('HSET', KEYS[1], 'stage', stage)
if openedAt then redis.call('HSET', KEYS[1], 'stage_started_at_ms', openedAt) end
for i = 1,4 do if redis.call('EXISTS', KEYS[i]) == 1 then redis.call('EXPIRE', KEYS[i], tonumber(ARGV[5])) end end
local remaining = -1
if stage < 2 and openedAt then remaining = math.max(0, openedAt + maxWait - now) end
return {stage, threshold, counts[1], counts[2], counts[3], maxWait, remaining, now, openedAt or 0}
`;

export function admissionGroup(exam: AdmissionExam): string {
  const date = exam.starts_at instanceof Date ? exam.starts_at : new Date(String(exam.starts_at));
  if (!Number.isFinite(date.getTime())) throw new Error('Jadwal ujian tidak valid');
  const parts = new Intl.DateTimeFormat('en', { timeZone: process.env.EXAM_ADMISSION_TIMEZONE ?? 'Asia/Jakarta', calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const day = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
  return createHash('sha256').update(JSON.stringify([String(exam.academic_year), String(exam.semester), day, Number(exam.session_number)])).digest('hex').slice(0, 32);
}

function gradeOf(value: unknown): AdmissionGrade {
  const grade = String(value).trim().toUpperCase();
  if (!admissionGrades.includes(grade as AdmissionGrade)) throw Object.assign(new Error('Tingkat siswa tidak valid'), { statusCode: 422 });
  return grade as AdmissionGrade;
}

export class ExamAdmissionService {
  readonly enabled: boolean;
  private readonly threshold: number;
  private readonly ttlSeconds: number;
  private readonly maxWaitSeconds: number;
  private readonly secret: string;

  constructor(private readonly redis: Redis | null, options: { enabled?: boolean; threshold?: number; ttlSeconds?: number; maxWaitSeconds?: number; secret?: string } = {}) {
    this.enabled = options.enabled ?? process.env.EXAM_GRADE_ADMISSION_ENABLED !== 'false';
    this.threshold = options.threshold ?? Number(process.env.EXAM_GRADE_ADMISSION_THRESHOLD ?? 300);
    this.ttlSeconds = options.ttlSeconds ?? Number(process.env.EXAM_GRADE_ADMISSION_TTL_SECONDS ?? 172800);
    this.maxWaitSeconds = options.maxWaitSeconds ?? Number(process.env.EXAM_GRADE_ADMISSION_MAX_WAIT_SECONDS ?? 180);
    this.secret = options.secret ?? (process.env.AUTH_TOKEN_SECRET || 'local-development-only');
    if (!Number.isSafeInteger(this.threshold) || this.threshold < 1 || !Number.isSafeInteger(this.maxWaitSeconds) || this.maxWaitSeconds < 1 || this.maxWaitSeconds > 3600 || !Number.isSafeInteger(this.ttlSeconds) || this.ttlSeconds < 3600) throw new Error('Konfigurasi antrean mulai ujian tidak valid');
  }

  ticket(studentId: number, examId: number, grade: unknown, exam: AdmissionExam) {
    if (!this.enabled) return undefined;
    const payload = Buffer.from(JSON.stringify({ studentId, examId, grade: gradeOf(grade), group: admissionGroup(exam), exp: Math.floor(Date.now() / 1000) + 12 * 3600 } satisfies Ticket)).toString('base64url');
    return `${payload}.${createHmac('sha256', this.secret).update(payload).digest('base64url')}`;
  }

  async statusForTicket(value: string, studentId: number, examId: number) {
    const parts = value.split('.');
    if (parts.length !== 2) throw Object.assign(new Error('Tiket antrean tidak valid'), { statusCode: 403 });
    const [payload, signature] = parts as [string, string];
    const actual = Buffer.from(signature, 'base64url');
    const expected = createHmac('sha256', this.secret).update(payload).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Object.assign(new Error('Tiket antrean tidak valid'), { statusCode: 403 });
    let ticket: Ticket;
    try { ticket = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Ticket; }
    catch { throw Object.assign(new Error('Tiket antrean tidak valid'), { statusCode: 403 }); }
    if (ticket.studentId !== studentId || ticket.examId !== examId || !Number.isSafeInteger(ticket.exp) || ticket.exp <= Math.floor(Date.now() / 1000) || !/^[a-f0-9]{32}$/.test(ticket.group)) throw Object.assign(new Error('Tiket antrean kedaluwarsa atau tidak sesuai sesi'), { statusCode: 403 });
    return this.status(ticket.group, gradeOf(ticket.grade));
  }

  async status(group: string, grade: AdmissionGrade) { return this.run('status', group, grade); }
  async inspect(group: string) { return this.run('peek', group, 'XII'); }
  async recordStarted(group: string, grade: AdmissionGrade, studentId: number) { return this.run('started', group, grade, studentId); }
  async advance(group: string, expectedGrade: AdmissionGrade) { return this.run('advance', group, expectedGrade); }

  async assertCanStart(exam: AdmissionExam, grade: unknown) {
    if (!this.enabled) return;
    const status = await this.status(admissionGroup(exam), gradeOf(grade));
    if (!status.allowed) throw Object.assign(new Error('Silakan tunggu, sesi Anda akan segera dimulai...'), { statusCode: 425 });
  }

  async started(exam: AdmissionExam, grade: unknown, studentId: number) {
    if (this.enabled) await this.recordStarted(admissionGroup(exam), gradeOf(grade), studentId);
  }

  private async run(action: string, group: string, grade: AdmissionGrade, studentId = 0) {
    if (!this.enabled) return { enabled: false, allowed: true, current_grade: 'X' as AdmissionGrade, threshold: this.threshold, max_wait_seconds: this.maxWaitSeconds, next_stage_in_seconds: null, server_time: new Date().toISOString(), stage_started_at: null, policy_version: 'quota-or-time-v2', counts: { XII: 0, XI: 0, X: 0 } };
    if (!this.redis || this.redis.status !== 'ready') throw Object.assign(new Error('Antrean ujian belum tersedia. Silakan tunggu sebentar.'), { statusCode: 503 });
    const base = `arena:admission:{${group}}`;
    let result: number[];
    try {
      result = await this.redis.eval(admissionLua, 4, `${base}:state`, `${base}:XII`, `${base}:XI`, `${base}:X`, action, admissionGrades.indexOf(grade), this.threshold, studentId, this.ttlSeconds, admissionGrades.indexOf(grade), this.maxWaitSeconds * 1000) as number[];
    } catch (cause) {
      // Keep the failure message for diagnostics, excluding Redis command args.
      const detail = new Error(cause instanceof Error ? cause.message : 'Redis command failed');
      throw Object.assign(new Error('Antrean ujian belum tersedia. Silakan tunggu sebentar.', { cause: detail }), { statusCode: 503 });
    }
    const [stage, threshold, XII, XI, X, maxWaitMs, remainingMs, nowMs, openedAtMs] = result as [number, number, number, number, number, number, number, number, number];
    return { enabled: true, allowed: admissionGrades.indexOf(grade) <= stage, current_grade: admissionGrades[stage]!, threshold, max_wait_seconds: maxWaitMs / 1000, next_stage_in_seconds: remainingMs < 0 ? null : Math.ceil(remainingMs / 1000), server_time: new Date(nowMs).toISOString(), stage_started_at: openedAtMs ? new Date(openedAtMs).toISOString() : null, policy_version: 'quota-or-time-v2', counts: { XII, XI, X } };
  }
}

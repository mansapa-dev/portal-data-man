import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { ExamAdmissionService, admissionGroup } from '../dist/services/exam-admission.js';
import { StudentExamService } from '../dist/services/student-exam.js';

const scope = () => randomBytes(16).toString('hex');
const schedule = { academic_year: '2026/2027', semester: 'ODD', starts_at: new Date('2026-11-09T01:00:00Z'), session_number: 1 };
const secret = 'dummy-test-secret-for-admission-123456789';

test('admission groups join grade packages in the same school day and session', () => {
  assert.equal(admissionGroup(schedule), admissionGroup({ ...schedule, starts_at: new Date('2026-11-09T02:30:00Z') }));
  assert.equal(admissionGroup(schedule), admissionGroup({ ...schedule, starts_at: new Date('2026-11-08T18:00:00Z') }));
  assert.notEqual(admissionGroup(schedule), admissionGroup({ ...schedule, session_number: 2 }));
  assert.notEqual(admissionGroup(schedule), admissionGroup({ ...schedule, starts_at: new Date('2026-11-10T01:00:00Z') }));
  assert.notEqual(admissionGroup(schedule), admissionGroup({ ...schedule, semester: 'EVEN' }));
});

test('missing Redis blocks new admission; disabled gate needs no Redis', async () => {
  const gate = new ExamAdmissionService(null, { enabled: true, secret });
  await assert.rejects(gate.assertCanStart(schedule, 'XII'), { statusCode: 503 });
  const disabled = new ExamAdmissionService(null, { enabled: false, secret });
  await disabled.assertCanStart(schedule, 'X');
  assert.equal(disabled.ticket(1, 2, 'X', schedule), undefined);
});

test('polling tickets cannot be reused for another student/exam or forged', async () => {
  const gate = new ExamAdmissionService(null, { enabled: false, secret });
  const issuer = new ExamAdmissionService(null, { enabled: true, secret });
  const ticket = issuer.ticket(1, 2, 'XI', schedule);
  await assert.rejects(gate.statusForTicket(ticket, 3, 2), { statusCode: 403 });
  await assert.rejects(gate.statusForTicket(ticket, 1, 3), { statusCode: 403 });
  await assert.rejects(gate.statusForTicket(`${ticket}tampered`, 1, 2), { statusCode: 403 });
});

test('an existing attempt resumes during a Redis interruption without re-entering the gate', async () => {
  const attempt = { id: 7, public_id: 'A'.repeat(26), status: 'IN_PROGRESS', can_resume: 1, question_order: '[5]', option_mapping: '{"5":["A","B"]}', expires_at: new Date(Date.now() + 3600000) };
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql) {
      if (sql.includes('SELECT 1 active')) return [[{ active: 1 }]];
      if (sql.includes('FROM exam_attempts WHERE')) return [[attempt]];
      if (sql.includes('FROM exams e')) return [[{ ...schedule, id: 2, name: 'Dummy' }]];
      if (sql.includes('FROM attempt_questions')) return [[{ id: 5, question_type: 'MULTIPLE_CHOICE', question_text: 'Dummy', option_a: 'A', option_b: 'B', points: 1 }]];
      if (sql.includes('FROM answer_write_versions')) return [[]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const pool = { async execute() { return [[{ id: 1, grade_snapshot: 'XI', attempt_id: 7 }]]; }, async getConnection() { return connection; } };
  const gate = { async assertCanStart() { assert.fail('Resume must bypass admission'); }, async started() { throw Object.assign(new Error('Redis unavailable'), { statusCode: 503 }); } };
  const result = await new StudentExamService(pool, undefined, gate).start(1, 2);
  assert.equal(result.attempt_id, attempt.public_id);
  assert.equal(result.soal.length, 1);
});

test('Redis atomically opens XI at 300 unique XII, then X at 300 unique XI', { skip: !process.env.REDIS_TEST_URL }, async () => {
  const redis = new Redis(process.env.REDIS_TEST_URL, { maxRetriesPerRequest: 1 });
  try {
    await redis.ping();
    const gate = new ExamAdmissionService(redis, { enabled: true, threshold: 300, secret });
    const group = scope();
    assert.equal((await gate.status(group, 'XII')).allowed, true);
    assert.equal((await gate.status(group, 'XI')).allowed, false);
    await Promise.all(Array.from({ length: 299 }, (_, i) => gate.recordStarted(group, 'XII', i + 1)));
    assert.equal((await gate.status(group, 'XI')).allowed, false);
    await Promise.all(Array.from({ length: 20 }, () => gate.recordStarted(group, 'XII', 300)));
    const status = await gate.status(group, 'XI');
    assert.equal(status.allowed, true);
    assert.equal(status.counts.XII, 300);
    assert.equal((await gate.status(group, 'X')).allowed, false);
    await Promise.all(Array.from({ length: 300 }, (_, i) => gate.recordStarted(group, 'XI', 1000 + i)));
    assert.equal((await gate.status(group, 'X')).allowed, true);
    assert.equal((await gate.status(scope(), 'XI')).allowed, false);

    const manual = scope();
    const [first, repeat] = await Promise.all([gate.advance(manual, 'XII'), gate.advance(manual, 'XII')]);
    assert.equal(first.current_grade, 'XI');
    assert.equal(repeat.current_grade, 'XI');
    assert.equal((await gate.advance(manual, 'XI')).current_grade, 'X');

    const ticket = gate.ticket(1, 2, 'XII', { ...schedule, academic_year: `dummy-${scope()}` });
    assert.equal((await gate.statusForTicket(ticket, 1, 2)).allowed, true);
  } finally { await redis.quit(); }
});

test('server rejects direct XI start before reading source questions or inserting an attempt', { skip: !process.env.REDIS_TEST_URL }, async () => {
  const redis = new Redis(process.env.REDIS_TEST_URL, { maxRetriesPerRequest: 1 });
  try {
    await redis.ping();
    // Fresh scope for this run, independent of all other tests.
    const exam = { ...schedule, academic_year: `dummy-${scope()}`, id: 2, duration_minutes: 60, ends_at: new Date(Date.now() + 3600000) };
    let rolledBack = false, released = false;
    const connection = {
      async beginTransaction() {}, async commit() {}, async rollback() { rolledBack = true; }, release() { released = true; },
      async execute(sql) { assert.match(sql, /FROM exams e/); return [[exam]]; },
      async query() { assert.fail('No attempt/snapshot writes are allowed before admission'); },
    };
    const pool = { async execute() { return [[{ id: 1, grade_snapshot: 'XI' }]]; }, async getConnection() { return connection; } };
    const service = new StudentExamService(pool, undefined, new ExamAdmissionService(redis, { enabled: true, threshold: 300, secret }));
    await assert.rejects(service.start(1, 2), { statusCode: 425 });
    assert.equal(rolledBack, true);
    assert.equal(released, true);
  } finally { await redis.quit(); }
});

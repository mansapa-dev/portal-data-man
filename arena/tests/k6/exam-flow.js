import http from 'k6/http';
import { check, sleep } from 'k6';

const fixture = JSON.parse(open(__ENV.K6_TOKENS_FILE || '../../tmp/perf-tokens.json'));
const users = fixture.users;
const vus = Number(__ENV.VUS || 1015);
const base = __ENV.BASE_URL || 'http://127.0.0.1:3001';
const answerPause = __ENV.STRESS === 'true' ? 0.3 : 3;
const legacy = __ENV.LEGACY === 'true';

export const options = {
  scenarios: { exam: { executor: 'per-vu-iterations', vus, iterations: 1, maxDuration: '20m' } },
  thresholds: { http_req_failed: ['rate==0'], checks: ['rate==1'] },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const user = users[(__VU - 1) % users.length];
  const examId = user.exam_id || fixture.exam_id;
  const headers = { Authorization: `Bearer ${user.token}`, 'X-CSRF-Token': user.csrf, 'Content-Type': 'application/json' };
  const params = { headers, tags: { flow: 'exam' } };
  if (__ENV.MODE !== 'simultaneous') sleep(Math.random() * 10);
  if (user.admission_ticket) {
    const deadline = Date.now() + 10 * 60 * 1000;
    let allowed = false;
    while (Date.now() < deadline) {
      const status = http.get(`${base}/api/student/exams/${examId}/admission?ticket=${encodeURIComponent(user.admission_ticket)}`, { ...params, tags: { step: 'admission' } });
      if (!check(status, { 'admission 200': (r) => r.status === 200 })) return;
      if (status.json('allowed')) { allowed = true; break; }
      sleep(5 + Math.random() * 5);
    }
    if (!check(allowed, { 'cohort opened before deadline': (value) => value })) return;
    if (__ENV.MODE !== 'simultaneous') sleep(Math.random() * 10);
  }
  const started = http.post(`${base}/api/student/exams/${examId}/start`, '{}', { ...params, tags: { step: 'start' } });
  if (!check(started, { 'start 200': (r) => r.status === 200 })) return;
  const attempt = started.json();
  const pending = [];
  const revisions = {};
  for (let i = 0; i < attempt.soal.length; i++) {
    const question = attempt.soal[i];
    const answer = question.tipe === 'SHORT_ANSWER' ? 'dummy' : question.opsi[0]?.key || null;
    const item = { question_id: question.id, answer, is_flagged: false, base_revision: revisions[question.id] || 0, mutation_id: `k6_${__VU}_${i}_${Date.now()}` };
    if (legacy) {
      const result = http.put(`${base}/api/student/exams/${examId}/answers/${question.id}`,
        JSON.stringify({ attempt_id: attempt.attempt_id, answer, is_flagged: false, base_revision: item.base_revision, mutation_id: item.mutation_id }),
        { ...params, tags: { step: 'answer_legacy' } });
      if (!check(result, { 'answer 200': (r) => r.status === 200 })) return;
      revisions[question.id] = result.json('revision');
    } else {
      pending.push(item);
      if (pending.length >= 4 || i === attempt.soal.length - 1) {
        const result = http.post(`${base}/api/student/exams/${examId}/answers/batch`, JSON.stringify({ attempt_id: attempt.attempt_id, answers: pending }),
          { ...params, tags: { step: 'answer_batch' } });
        if (!check(result, { 'batch 200': (r) => r.status === 200 })) return;
        Object.assign(revisions, result.json('revisions'));
        pending.length = 0;
      }
    }
    if (i !== attempt.soal.length - 1) sleep(answerPause);
  }
  const submitted = http.post(`${base}/api/student/exams/${examId}/submit`, '{}', { ...params, tags: { step: 'submit' } });
  check(submitted, { 'submit 200': (r) => r.status === 200 });
}

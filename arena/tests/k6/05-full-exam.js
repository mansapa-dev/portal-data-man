import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const fullExamDuration = new Trend('full_exam_duration_ms', true);
const examCompletedCount = new Counter('exam_completed_total');
const examResultPolledCount = new Counter('exam_result_polled_total');
const fullExamErrors = new Rate('full_exam_error_rate');

const fixture = JSON.parse(open(__ENV.FIXTURE_FILE || './fixtures/users-1200.json'));
const users = fixture.users || [];
const examId = fixture.exam_id || 1;
const base = __ENV.BASE_URL || 'http://127.0.0.1';

export const options = {
  scenarios: {
    full_cohort: {
      executor: 'per-vu-iterations',
      vus: 1200,
      iterations: 1,
      maxDuration: '90m',
    },
  },
  thresholds: {
    full_exam_error_rate: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const user = users[(__VU - 1) % users.length] || { nisn: `10000000${__VU}`, pin: '123456' };
  const overallStart = Date.now();

  // 1. LOGIN WITH JITTER
  const digits = String(user.nisn).replace(/\D/g, '');
  const phase = digits ? Number(digits.slice(-6)) % 3000 : 0;
  const loginJitterMs = phase + Math.floor(Math.random() * 3000);
  sleep(loginJitterMs / 1000);

  let loginRes = http.post(`${base}/api/auth/student/login`, JSON.stringify({
    nisn: String(user.nisn),
    pin: String(user.pin),
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { step: 'login' },
    timeout: '25s',
  });

  if (loginRes.status === 503) {
    const retryAfter = Number(loginRes.headers['Retry-After'] || 2);
    sleep(retryAfter + Math.random());
    loginRes = http.post(`${base}/api/auth/student/login`, JSON.stringify({
      nisn: String(user.nisn),
      pin: String(user.pin),
    }), {
      headers: { 'Content-Type': 'application/json' },
      tags: { step: 'login_retry' },
      timeout: '25s',
    });
  }

  if (!check(loginRes, { 'login success': (r) => r.status === 200 })) {
    fullExamErrors.add(1);
    return;
  }

  const loginData = loginRes.json();
  const token = loginData.token;
  const csrf = loginData.csrf_token;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };

  // 2. WAITING ROOM (if active)
  let admitted = false;
  let admitToken = '';
  const joinRes = http.post(`${base}/api/student/exams/${examId}/waiting/join`, '{}', { headers, tags: { step: 'waiting_join' } });
  if (joinRes.status === 200) {
    let state = joinRes.json();
    if (state.status === 'ADMITTED') {
      admitted = true;
      admitToken = state.admit_token;
    } else {
      const waitDeadline = Date.now() + 10 * 60 * 1000;
      while (state.status === 'WAITING' && Date.now() < waitDeadline) {
        sleep(4.5 + Math.random());
        const statusRes = http.get(`${base}/api/student/exams/${examId}/waiting/status`, { headers, tags: { step: 'waiting_status' } });
        if (statusRes.status === 200) {
          state = statusRes.json();
          if (state.status === 'ADMITTED') {
            admitted = true;
            admitToken = state.admit_token;
            break;
          }
        }
      }
    }
  }

  // 3. START EXAM
  const startHeaders = Object.assign({}, headers);
  if (admitted && admitToken) {
    startHeaders['X-Exam-Token'] = admitToken;
  }
  const startRes = http.post(`${base}/api/student/exams/${examId}/start`, '{}', { headers: startHeaders, tags: { step: 'start' } });
  if (!check(startRes, { 'start success': (r) => r.status === 200 })) {
    fullExamErrors.add(1);
    return;
  }

  const startData = startRes.json();
  const attemptPublicId = startData.attempt_id;
  const questions = startData.soal || [];

  // 4. ANSWER 50 QUESTIONS WITH REALISTIC PACING & AUTOSAVE FLUSH
  let batch = [];
  const revisions = {};
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const choices = ['A', 'B', 'C', 'D', 'E'];
    const selectedAnswer = q.tipe === 'SHORT_ANSWER' ? 'jawaban siswa' : choices[i % 5];
    const mutationId = `mut_${user.nisn}_${q.id}_${Date.now()}`;

    batch.push({
      question_id: q.id,
      answer: selectedAnswer,
      is_flagged: false,
      base_revision: revisions[q.id] || 0,
      mutation_id: mutationId,
    });

    // Realistic answering time: between 10s and 30s per question
    sleep(1 + Math.random() * 2); // In load testing script, compressed pacing

    // Flush batch every 4 questions or on the last question
    if (batch.length >= 4 || i === questions.length - 1) {
      const batchRes = http.post(`${base}/api/student/exams/${examId}/answers/batch`, JSON.stringify({
        attempt_id: attemptPublicId,
        answers: batch,
      }), { headers, tags: { step: 'autosave_batch' } });

      check(batchRes, { 'autosave batch 200': (r) => r.status === 200 });
      if (batchRes.status === 200) {
        Object.assign(revisions, batchRes.json().revisions || {});
      }
      batch = [];
    }

    // Occasional heartbeat every ~15 questions
    if (i % 15 === 0) {
      http.post(`${base}/api/student/exams/${examId}/heartbeat`, '{}', { headers, tags: { step: 'heartbeat' } });
    }
  }

  // 5. SUBMIT EXAM WITH JITTER
  // submitJitterMs: 0..2,000ms
  sleep(Math.random() * 2);

  const submitRes = http.post(`${base}/api/student/exams/${examId}/submit`, JSON.stringify({ finalize_only: false }), {
    headers,
    tags: { step: 'submit' },
  });

  if (!check(submitRes, { 'submit status 200': (r) => r.status === 200 })) {
    fullExamErrors.add(1);
    return;
  }

  examCompletedCount.add(1);

  // 6. RESULT POLLING (Async submit: poll with backoff until completed)
  let pollAttempts = 0;
  const pollMax = 14;
  let finalResult = null;
  while (pollAttempts < pollMax) {
    pollAttempts++;
    const resultRes = http.get(`${base}/api/student/exams/${examId}/result`, { headers, tags: { step: 'result_poll' } });
    if (resultRes.status === 200) {
      const resData = resultRes.json();
      if (resData.status !== 'processing' && resData.status !== 'accepted') {
        finalResult = resData;
        break;
      }
    }
    // Result poll backoff delay (2s to 10s)
    const baseDelay = [2, 2, 3, 4.5, 6, 8, 10][Math.min(pollAttempts - 1, 6)];
    sleep(baseDelay * (0.75 + Math.random() * 0.5));
  }

  check(finalResult, {
    'result finalized': (r) => r !== null && (r.nilai !== undefined || r.status === 'selesai' || r.status === 'COMPLETED'),
  });

  if (finalResult) {
    examResultPolledCount.add(1);
  }

  fullExamDuration.add(Date.now() - overallStart);
}


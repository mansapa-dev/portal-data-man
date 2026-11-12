import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const autosaveDuration = new Trend('autosave_duration_ms', true);
const autosaveFailures = new Rate('autosave_failure_rate');
const savedAnswers = new Counter('autosave_saved_total');
const duplicateAck = new Counter('autosave_duplicate_ack');

const fixture = JSON.parse(open(__ENV.FIXTURE_FILE || './fixtures/active-attempts-1200.json'));
const students = fixture.students || [];
const examId = fixture.exam_id || 1;
const base = __ENV.BASE_URL || 'http://127.0.0.1';
const mode = __ENV.MODE || 'realistic'; // 'realistic' or 'worst-case'

export const options = {
  scenarios: {
    autosave_traffic: {
      executor: 'per-vu-iterations',
      vus: 1200,
      iterations: 10, // each student saves 10 answers
      maxDuration: '10m',
    },
  },
  thresholds: {
    autosave_failure_rate: ['rate<0.001'], // failure < 0.1%
    'autosave_duration_ms{expected_response:true}': ['p(95)<500', 'p(99)<2000'], // p95 < 500ms, p99 < 2s
    checks: ['rate>0.999'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const student = students[(__VU - 1) % students.length];
  if (!student) return;

  const questionId = (__ITER % 50) + 1;
  const answerChoices = ['A', 'B', 'C', 'D', 'E'];
  const answer = answerChoices[Math.floor(Math.random() * answerChoices.length)];
  const mutationId = `k6_mut_${student.id}_${questionId}_${__ITER}_${Date.now()}`;

  // Jitter calculation
  if (mode === 'realistic') {
    // Formula from apps/web/src/lib/load-shape.ts:
    // phase = student.id % 500ms
    // delay = 2500ms + phase + random(0..2500ms) = 2.5s to 5.5s
    const phase = (Number(student.id) || __VU) % 500;
    const delayMs = 2500 + phase + Math.floor(Math.random() * 2500);
    sleep(delayMs / 1000);
  } else {
    // Worst-case synchronized stress test
    sleep(0.1);
  }

  const payload = JSON.stringify({
    attempt_id: student.attempt_public_id,
    answer: answer,
    is_flagged: false,
    base_revision: 0,
    mutation_id: mutationId,
  });

  const headers = {
    'Authorization': `Bearer ${student.token}`,
    'X-CSRF-Token': student.csrf || '',
    'Content-Type': 'application/json',
  };

  const start = Date.now();
  const res = http.put(`${base}/api/student/exams/${examId}/answers/${questionId}`, payload, {
    headers,
    tags: { step: 'autosave' },
    timeout: '5s',
  });
  const duration = Date.now() - start;

  autosaveDuration.add(duration);

  const success = check(res, {
    'autosave 200': (r) => r.status === 200,
    'has revision': (r) => {
      try {
        const json = r.json();
        return typeof json.revision === 'number';
      } catch {
        return false;
      }
    },
  });

  autosaveFailures.add(!success);

  if (res.status === 200) {
    try {
      const data = res.json();
      if (data.duplicate) duplicateAck.add(1);
      else savedAnswers.add(1);
    } catch {}
  }
}


import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const startDuration = new Trend('start_duration_ms', true);
const startFailures = new Rate('start_failure_rate');

const fixture = JSON.parse(open(__ENV.FIXTURE_FILE || './fixtures/users-1200.json'));
const users = fixture.users || [];
const examId = fixture.exam_id || 1;
const base = __ENV.BASE_URL || 'http://127.0.0.1';

export const options = {
  scenarios: {
    staggered_start: {
      executor: 'ramping-arrival-rate',
      startRate: 30, // 30 req/sec = 300 starts per 10s
      timeUnit: '1s',
      preAllocatedVUs: 300,
      maxVUs: 600,
      stages: [
        { duration: '10s', target: 30 }, // 300 starts in 10s
        { duration: '30s', target: 30 }, // sustained 30/s
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    start_failure_rate: ['rate<0.001'], // failure < 0.1%
    'start_duration_ms{expected_response:true}': ['p(95)<5000', 'p(99)<8000'], // p95 < 5s
    checks: ['rate>0.999'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const user = users[__ITER % users.length];
  if (!user || !user.token) return;

  const headers = {
    'Authorization': `Bearer ${user.token}`,
    'X-CSRF-Token': user.csrf || '',
    'Content-Type': 'application/json',
  };

  const start = Date.now();
  const res = http.post(`${base}/api/student/exams/${examId}/start`, '{}', {
    headers,
    tags: { step: 'exam_start' },
    timeout: '15s',
  });
  const duration = Date.now() - start;

  startDuration.add(duration);

  const success = check(res, {
    'start status 200': (r) => r.status === 200,
    'has 50 questions': (r) => {
      try {
        const json = r.json();
        return Array.isArray(json.soal) && json.soal.length === 50;
      } catch {
        return false;
      }
    },
    'has attempt_id': (r) => {
      try {
        return Boolean(r.json().attempt_id);
      } catch {
        return false;
      }
    },
  });

  startFailures.add(!success);
}


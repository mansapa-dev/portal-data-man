import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const submitDuration = new Trend('submit_acceptance_ms', true);
const submitFailures = new Rate('submit_failure_rate');
const acceptedSubmissions = new Counter('submit_accepted_count');
const doneSubmissions = new Counter('submit_done_count');
const duplicateSubmissions = new Counter('submit_duplicate_count');

const fixture = JSON.parse(open(__ENV.FIXTURE_FILE || './fixtures/active-attempts-1200.json'));
const students = fixture.students || [];
const examId = fixture.exam_id || 1;
const base = __ENV.BASE_URL || 'http://127.0.0.1';
const windowSec = Number(__ENV.WINDOW_SECONDS || 5); // 60s, 30s, 10s, 5s, 2s

export const options = {
  scenarios: {
    submit_storm: {
      executor: 'ramping-arrival-rate',
      startRate: Math.ceil(1200 / windowSec),
      timeUnit: '1s',
      preAllocatedVUs: 600,
      maxVUs: 1200,
      stages: [
        { duration: `${windowSec}s`, target: Math.ceil(1200 / windowSec) }, // burst window
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    submit_failure_rate: ['rate<0.001'], // HTTP failure < 0.1%
    'submit_acceptance_ms{expected_response:true}': ['p(95)<500', 'p(99)<1000'], // p95 < 500ms
    checks: ['rate>0.999'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const student = students[__ITER % students.length];
  if (!student) return;

  const headers = {
    'Authorization': `Bearer ${student.token}`,
    'X-CSRF-Token': student.csrf || '',
    'Content-Type': 'application/json',
  };

  const start = Date.now();
  const res = http.post(`${base}/api/student/exams/${examId}/submit`, JSON.stringify({ finalize_only: false }), {
    headers,
    tags: { step: 'exam_submit' },
    timeout: '10s',
  });
  const duration = Date.now() - start;

  submitDuration.add(duration);

  const success = check(res, {
    'submit HTTP 200': (r) => r.status === 200,
    'accepted or completed': (r) => {
      try {
        const json = r.json();
        return json.status === 'accepted' || json.status === 'selesai' || json.status === 'COMPLETED';
      } catch {
        return false;
      }
    },
  });

  submitFailures.add(!success);

  if (res.status === 200) {
    try {
      const data = res.json();
      if (data.status === 'accepted') acceptedSubmissions.add(1);
      else if (data.status === 'selesai' || data.status === 'COMPLETED') doneSubmissions.add(1);
    } catch {}
  }

  // Test idempotency: send an immediate duplicate submit for the same student
  if (__ITER % 10 === 0) {
    const dupRes = http.post(`${base}/api/student/exams/${examId}/submit`, JSON.stringify({ finalize_only: false }), {
      headers,
      tags: { step: 'exam_submit_duplicate' },
    });
    check(dupRes, {
      'duplicate submit safe 200': (r) => r.status === 200,
    });
    duplicateSubmissions.add(1);
  }
}


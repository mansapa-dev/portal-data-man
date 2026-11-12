import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const loginDuration = new Trend('login_duration_ms', true);
const loginFailures = new Rate('login_failure_rate');
const loginQueueOverload = new Counter('login_queue_503');

// Fixture: users with NISN and PIN
const fixture = JSON.parse(open(__ENV.FIXTURE_FILE || './fixtures/users-1200.json'));
const users = fixture.users || [];
const base = __ENV.BASE_URL || 'http://127.0.0.1';

export const options = {
  scenarios: {
    mass_login: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 1200 }, // Ramp-up to 1,200 VUs in 10s
        { duration: '30s', target: 1200 }, // Hold for 30s
        { duration: '5s', target: 0 },     // Ramp-down
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    login_failure_rate: ['rate<0.01'], // failure < 1%
    'login_duration_ms{expected_response:true}': ['p(95)<8000', 'p(99)<12000'], // p95 < 8s
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const user = users[(__VU - 1) % users.length] || { nisn: `10000000${__VU}`, pin: '123456' };
  
  // Frontend login jitter formula: NISN phase (0..3s) + random (0..3s)
  const digits = String(user.nisn).replace(/\D/g, '');
  const phase = digits ? Number(digits.slice(-6)) % 3000 : 0;
  const jitterMs = phase + Math.floor(Math.random() * 3000);
  sleep(jitterMs / 1000);

  const payload = JSON.stringify({
    nisn: String(user.nisn),
    pin: String(user.pin),
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    tags: { step: 'student_login' },
    timeout: '25s',
  };

  const start = Date.now();
  const res = http.post(`${base}/api/auth/student/login`, payload, params);
  const duration = Date.now() - start;

  loginDuration.add(duration);

  if (res.status === 503) {
    loginQueueOverload.add(1);
  }

  const success = check(res, {
    'login status 200': (r) => r.status === 200,
    'has token': (r) => {
      try {
        const json = r.json();
        return Boolean(json && json.token && json.csrf_token);
      } catch {
        return false;
      }
    },
  });

  loginFailures.add(!success);

  // Backoff retry if 503 received with Retry-After header
  if (res.status === 503) {
    const retryAfter = Number(res.headers['Retry-After'] || 2);
    sleep(retryAfter + Math.random());
    const retryRes = http.post(`${base}/api/auth/student/login`, payload, params);
    check(retryRes, {
      'retry login succeeds': (r) => r.status === 200,
    });
  }

  sleep(5);
}


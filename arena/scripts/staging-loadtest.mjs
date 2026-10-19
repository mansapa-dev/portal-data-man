#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'mysql2/promise';

const STAGING_ORIGIN = 'https://staging.arena.man1palembang.sch.id';
const STAGING_DATABASE = 'arena_staging';
const MAX_DURATION_MS = 10 * 60_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_PREP_CONCURRENCY = 5;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function settings() {
  const origin = new URL(required('ARENA_LOADTEST_API_URL'));
  if (origin.origin !== STAGING_ORIGIN || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('API URL must be exactly the configured Arena staging origin.');
  }
  if (process.env.ARENA_LOADTEST_CONFIRM_STAGING !== 'I_ACCEPT_STAGING_DATA_CREATION') {
    throw new Error('Staging confirmation is missing; no requests were sent.');
  }
  if (required('ARENA_LOADTEST_DB_NAME') !== STAGING_DATABASE) {
    throw new Error(`Database name must be exactly ${STAGING_DATABASE}.`);
  }
  const scenario = required('ARENA_LOADTEST_SCENARIO');
  if (!['login', 'autosave', 'submit'].includes(scenario)) throw new Error('Scenario must be login, autosave, or submit.');
  const concurrency = Number(required('ARENA_LOADTEST_CONCURRENCY'));
  if (!Number.isInteger(concurrency) || ![25, 50, 100].includes(concurrency)) {
    throw new Error('Concurrency must be one of the staged levels: 25, 50, or 100.');
  }
  const timeoutMs = Number(process.env.ARENA_LOADTEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const durationMs = Number(process.env.ARENA_LOADTEST_MAX_DURATION_MS ?? MAX_DURATION_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) throw new Error('Request timeout must be 1000–60000 ms.');
  if (!Number.isInteger(durationMs) || durationMs < 10_000 || durationMs > MAX_DURATION_MS) throw new Error('Maximum duration must be 10000–600000 ms.');
  return {
    origin: origin.origin,
    scenario,
    concurrency,
    timeoutMs,
    durationMs,
    usersFile: required('ARENA_LOADTEST_USERS_FILE'),
    dbUrl: required('ARENA_LOADTEST_DATABASE_URL'),
    examId: scenario === 'login' ? null : Number(required('ARENA_LOADTEST_EXAM_ID')),
  };
}

async function loadUsers(file, count) {
  const text = await readFile(file, 'utf8');
  const users = text.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [nisn, pin, ...extra] = line.split('\t');
      if (extra.length || !/^\d{8,20}$/u.test(nisn ?? '') || !/^\d{4,12}$/u.test(pin ?? '')) {
        throw new Error('Participant file must contain only NISN<TAB>PIN rows with valid digit lengths.');
      }
      return { nisn, pin };
    });
  if (users.length < count) throw new Error(`Participant file has ${users.length} users; ${count} are required.`);
  if (new Set(users.map((user) => user.nisn)).size !== users.length) throw new Error('Participant NISNs must be unique.');
  return users.slice(0, count);
}

let interrupted = false;
let durationReached = false;
const abortController = new AbortController();
function interrupt() {
  interrupted = true;
  abortController.abort(new Error('Emergency stop requested.'));
}
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

async function main() {
  const config = settings();
  const users = await loadUsers(config.usersFile, config.concurrency);
  const dbUrl = new URL(config.dbUrl);
  if (!['mysql:', 'mysql2:'].includes(dbUrl.protocol) || decodeURIComponent(dbUrl.pathname.slice(1)) !== STAGING_DATABASE) {
    throw new Error(`Verification DB URL must point to ${STAGING_DATABASE}.`);
  }
  if (decodeURIComponent(dbUrl.username) !== 'arena_loadtest_audit') throw new Error('Use the dedicated read-only arena_loadtest_audit database user.');
  const startedAt = performance.now();
  const durationTimer = setTimeout(() => { durationReached = true; abortController.abort(new Error('Maximum test duration reached.')); }, config.durationMs);
  durationTimer.unref();
  if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname)) throw new Error('Database verification must use the VPS-local MySQL host.');
  const db = await createConnection({
    host: dbUrl.hostname,
    port: Number(dbUrl.port || 3306),
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    database: STAGING_DATABASE,
    connectTimeout: config.timeoutMs,
  });
  let summary = null;
  try {
    const [identityRows] = await db.query('SELECT DATABASE() database_name, @@hostname hostname, @@read_only read_only');
    const identity = identityRows[0];
    if (identity?.database_name !== STAGING_DATABASE) throw new Error('Connected database is not the approved staging database.');
    const ready = await fetch(`${config.origin}/health/ready`, { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(config.timeoutMs)]) });
    if (!ready.ok) throw new Error(`Staging readiness check failed with HTTP ${ready.status}.`);

    const stageLabel = config.examId === null ? 'login' : `${config.scenario}, exam ${config.examId}`;
    console.log(`Starting staging-only ${stageLabel}: ${config.concurrency} users; max ${config.durationMs / 1000}s; request timeout ${config.timeoutMs}ms.`);
    const participants = users.map((user, index) => ({ ...user, index, auth: null, attempt: null }));
    const metrics = [];
    const prepErrors = [];
    const prepMetrics = [];

    async function call(method, path, { token, csrf, body } = {}) {
      const headers = { accept: 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      if (csrf) headers['x-csrf-token'] = csrf;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const before = performance.now();
      try {
        const response = await fetch(`${config.origin}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(config.timeoutMs)]),
        });
        const elapsed = performance.now() - before;
        let data = null;
        try { data = await response.json(); } catch { /* response bodies are intentionally not logged */ }
        return { status: response.status, endpoint: endpointLabel(method, path), elapsed, data };
      } catch (error) {
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError' && !interrupted && !abortController.signal.reason?.message?.includes('Maximum test duration');
        return { status: 0, endpoint: endpointLabel(method, path), elapsed: performance.now() - before, error: timeout ? 'timeout' : 'aborted' };
      }
    }

    async function callIdempotent(method, path, options) {
      const attempts = [];
      attempts.push(await call(method, path, options));
      const first = attempts[0];
      const retryable = first.error === 'timeout' || first.status >= 500;
      if (retryable && !abortController.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!abortController.signal.aborted) attempts.push({ ...(await call(method, path, options)), retry: true });
      }
      return attempts;
    }

    async function worker(items, limit, action, onError = prepErrors) {
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (!abortController.signal.aborted) {
          const index = next++;
          if (index >= items.length) return;
          try { await action(items[index], index); }
          catch (error) { onError.push({ index, message: safeMessage(error) }); }
        }
      }));
    }

    async function login(participant, collected = prepMetrics) {
      const response = await call('POST', '/api/auth/student/login', { body: { nisn: participant.nisn, pin: participant.pin } });
      collected.push(response);
      if (response.status !== 200 || !response.data?.token || !response.data?.csrf_token) throw new Error(`login HTTP ${response.status || response.error}`);
      participant.auth = { token: response.data.token, csrf: response.data.csrf_token, studentId: Number(response.data.student?.id) };
      if (!Number.isSafeInteger(participant.auth.studentId)) throw new Error('login response has no student id');
      return response;
    }

    if (config.scenario === 'login') {
      const waveStart = performance.now();
      await worker(participants, config.concurrency, async (participant) => {
        await login(participant, metrics);
      });
      summary = report('login', metrics, prepErrors, performance.now() - waveStart, config.concurrency, []);
    } else {
      const examId = config.examId;
      if (!Number.isSafeInteger(examId) || examId <= 0) throw new Error('Exam ID must be a positive integer.');
      await worker(participants, MAX_PREP_CONCURRENCY, async (participant) => {
        await login(participant);
        const available = await call('GET', '/api/student/exams', { token: participant.auth.token });
        prepMetrics.push(available);
        if (available.status !== 200) throw new Error(`exam list HTTP ${available.status || available.error}`);
        const assignment = Array.isArray(available.data) ? available.data.find((exam) => Number(exam.id) === examId) : null;
        if (!assignment || !String(assignment.nama_ujian ?? '').startsWith('LOADTEST-') || assignment.can_start !== true) {
          throw new Error('participant is not eligible for an active LOADTEST- exam');
        }
        const started = await call('POST', `/api/student/exams/${examId}/start`, { token: participant.auth.token, csrf: participant.auth.csrf, body: {} });
        prepMetrics.push(started);
        if (started.status !== 200 || !started.data?.attempt_id || !Array.isArray(started.data.soal) || started.data.soal.length === 0) {
          throw new Error(`attempt start HTTP ${started.status || started.error}`);
        }
        if (!String(started.data.exam?.nama_ujian ?? '').startsWith('LOADTEST-')) throw new Error('Exam title must start with LOADTEST-.');
        participant.attempt = started.data;
      });
      if (prepErrors.length || participants.some((participant) => !participant.attempt) || abortController.signal.aborted) {
        const failedPreparation = report(`${config.scenario} preparation`, prepMetrics, prepErrors, performance.now() - startedAt, config.concurrency, []);
        console.log(JSON.stringify({ ...failedPreparation, load_wave_sent: false, interrupted }, null, 2));
        throw new Error('Preparation incomplete; load wave was not sent. Created staging attempts are retained for audit.');
      }

      const target = config.scenario === 'autosave' ? 'PUT /api/student/exams/:id/answers/:questionId' : 'POST submit + concurrent autosave';
      const waveStart = performance.now();
      await worker(participants, config.concurrency, async (participant) => {
        if (config.scenario === 'autosave') {
          const question = participant.attempt.soal[0];
          const choices = Array.isArray(question.opsi) ? question.opsi : [];
          if (question.tipe !== 'SHORT_ANSWER' && choices.length === 0) throw new Error('test exam question has no valid answer choices');
          const first = choices[0]?.key;
          const second = choices[1]?.key;
          const answer1 = first ? String(first) : 'LOADTEST-ANSWER-A';
          const answer2 = second ? String(second) : 'LOADTEST-ANSWER-B';
          let revision = 0;
          for (const answer of [answer1, answer2]) {
            const requestBody = {
              answer, is_flagged: false, attempt_id: participant.attempt.attempt_id, base_revision: revision, mutation_id: randomUUID().replaceAll('-', '_'),
            };
            const retries = await callIdempotent('PUT', `/api/student/exams/${examId}/answers/${question.id}`, {
              token: participant.auth.token,
              csrf: participant.auth.csrf,
              body: requestBody,
            });
            metrics.push(...retries);
            const saved = retries.at(-1);
            if (saved.status !== 200 || !Number.isSafeInteger(saved.data?.revision)) throw new Error(`autosave HTTP ${saved.status || saved.error}`);
            revision = saved.data.revision;
          }
        } else {
          const question = participant.attempt.soal[0];
          if (question.tipe !== 'SHORT_ANSWER' && (!Array.isArray(question.opsi) || question.opsi.length === 0)) throw new Error('test exam question has no valid answer choices');
          const first = question.opsi?.[0]?.key;
          const saved = await call('PUT', `/api/student/exams/${examId}/answers/${question.id}`, {
            token: participant.auth.token,
            csrf: participant.auth.csrf,
            body: { answer: first ? String(first) : 'LOADTEST-ANSWER', is_flagged: false, attempt_id: participant.attempt.attempt_id, base_revision: 0, mutation_id: randomUUID().replaceAll('-', '_') },
          });
          prepMetrics.push(saved);
          if (saved.status !== 200) throw new Error(`pre-submit autosave HTTP ${saved.status || saved.error}`);
          participant.baselineAnswer = first ? String(first) : 'LOADTEST-ANSWER';
          const raceAnswer = question.opsi?.[1]?.key ? String(question.opsi[1].key) : 'LOADTEST-ANSWER-RACE';
          participant.testQuestionId = Number(question.id);
          participant.expectedRaceAnswer = raceAnswer;
          const raceMutation = { answer: raceAnswer, is_flagged: false, attempt_id: participant.attempt.attempt_id, base_revision: 1, mutation_id: randomUUID().replaceAll('-', '_') };
          const [raceSaves, submissions] = await Promise.all([
            callIdempotent('PUT', `/api/student/exams/${examId}/answers/${question.id}`, { token: participant.auth.token, csrf: participant.auth.csrf, body: raceMutation }),
            callIdempotent('POST', `/api/student/exams/${examId}/submit`, { token: participant.auth.token, csrf: participant.auth.csrf, body: {} }),
          ]);
          const raceSave = raceSaves.at(-1);
          participant.raceOutcomeUnknown = raceSaves.some((result) => result.error === 'timeout' || result.status >= 500);
          if (raceSave.status === 409) raceSave.expectedConflict = true;
          else if (raceSave.status === 200) participant.acknowledgedRaceAnswer = raceAnswer;
          else throw new Error(`concurrent autosave HTTP ${raceSave.status || raceSave.error}`);
          metrics.push(...raceSaves);
          metrics.push(...submissions);
          const submitted = submissions.at(-1);
          if (submitted.status !== 200) throw new Error(`submit HTTP ${submitted.status || submitted.error}`);
        }
      });
      summary = report(target, metrics, prepErrors, performance.now() - waveStart, config.concurrency, prepMetrics);

      const attemptIds = participants.map((participant) => participant.attempt.attempt_id);
      const verified = await verifyDatabase(db, config.scenario, participants, attemptIds);
      summary.database = verified;
      if (config.scenario === 'autosave' && verified.consistent && !abortController.signal.aborted) {
        const finalizationResults = [];
        const finalizationErrors = [];
        await worker(participants, MAX_PREP_CONCURRENCY, async (participant) => {
          const result = await callIdempotent('POST', `/api/student/exams/${examId}/submit`, { token: participant.auth.token, csrf: participant.auth.csrf, body: {} });
          finalizationResults.push(...result);
          if (result.at(-1).status !== 200) throw new Error(`test attempt finalization HTTP ${result.at(-1).status || result.at(-1).error}`);
        }, finalizationErrors);
        summary.test_attempt_finalization = report('test-attempt cleanup by submit', finalizationResults, finalizationErrors, performance.now() - waveStart, MAX_PREP_CONCURRENCY, []);
        summary.database_after_finalization = await verifyDatabase(db, 'autosave_finalized', participants, attemptIds);
      }
    }

    summary.environment = { origin: config.origin, database: STAGING_DATABASE, db_host: String(identity.hostname), users: config.concurrency, scenario: config.scenario };
    summary.elapsed_seconds = Number(((performance.now() - startedAt) / 1000).toFixed(2));
    summary.interrupted = interrupted;
    summary.max_duration_reached = durationReached;
    summary.pass = summary.errors === 0 && summary.preparation_errors === 0 && summary.timeouts === 0 && summary.preparation_timeouts === 0
      && summary.http_429 === 0 && summary.http_5xx === 0 && summary.preparation_http_429 === 0 && summary.preparation_http_5xx === 0
      && summary.latency_pass && (summary.test_attempt_finalization?.latency_pass ?? true)
      && summary.database?.consistent !== false && summary.database_after_finalization?.consistent !== false
      && (summary.test_attempt_finalization?.errors ?? 0) === 0 && !interrupted && !durationReached;
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.pass) process.exitCode = 2;
  } finally {
    clearTimeout(durationTimer);
    await db.end();
  }
}

function safeMessage(error) {
  const code = error?.code;
  return typeof code === 'string' ? `database/client error ${code}` : 'request preparation failed';
}

function percentile(values, percent) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(percent * sorted.length) - 1].toFixed(1));
}

function endpointLabel(method, path) {
  if (path === '/api/auth/student/login') return 'login';
  if (path === '/api/student/exams') return 'exam_list';
  if (path.endsWith('/start')) return 'start';
  if (path.includes('/answers/')) return 'autosave';
  if (path.endsWith('/submit')) return 'submit';
  return `${method.toLowerCase()}_other`;
}

function report(scenario, results, prepErrors, elapsedMs, concurrency, prepResults = []) {
  const successful = results.filter((result) => result.status >= 200 && result.status < 300).length;
  const failed = results.filter((result) => !(result.status >= 200 && result.status < 300) && !result.expectedConflict);
  const latencies = results.map((result) => result.elapsed);
  const endpointLatency = Object.fromEntries([...new Set(results.map((result) => result.endpoint ?? 'unknown'))].map((endpoint) => {
    const values = results.filter((result) => (result.endpoint ?? 'unknown') === endpoint).map((result) => result.elapsed);
    return [endpoint, { p50: percentile(values, 0.50), p95: percentile(values, 0.95), p99: percentile(values, 0.99) }];
  }));
  const latencyPass = Object.values(endpointLatency).every((latency) => latency.p95 < 2000 && latency.p99 < 5000);
  return {
    scenario,
    target_concurrency: concurrency,
    requests: results.length,
    retries: results.filter((result) => result.retry).length,
    successful,
    errors: failed.length + prepResults.filter((result) => !(result.status >= 200 && result.status < 300)).length,
    preparation_errors: prepErrors.length,
    timeouts: results.filter((result) => result.error === 'timeout').length,
    aborted: results.filter((result) => result.error === 'aborted').length,
    http_429: results.filter((result) => result.status === 429).length,
    http_5xx: results.filter((result) => result.status >= 500).length,
    expected_conflicts: results.filter((result) => result.expectedConflict).length,
    other_http_errors: results.filter((result) => result.status >= 300 && result.status < 500 && result.status !== 429 && !result.expectedConflict).length,
    throughput_success_per_second: elapsedMs > 0 ? Number((successful / (elapsedMs / 1000)).toFixed(2)) : 0,
    throughput_requests_per_second: elapsedMs > 0 ? Number((results.length / (elapsedMs / 1000)).toFixed(2)) : 0,
    latency_ms: { p50: percentile(latencies, 0.50), p95: percentile(latencies, 0.95), p99: percentile(latencies, 0.99), max: latencies.length ? Number(Math.max(...latencies).toFixed(1)) : null },
    endpoint_latency_ms: endpointLatency,
    latency_pass: latencyPass,
    wall_seconds: Number((elapsedMs / 1000).toFixed(2)),
    preparation_requests: prepResults.length,
    preparation_http_429: prepResults.filter((result) => result.status === 429).length,
    preparation_http_5xx: prepResults.filter((result) => result.status >= 500).length,
    preparation_timeouts: prepResults.filter((result) => result.error === 'timeout').length,
    database: null,
  };
}

async function verifyDatabase(db, scenario, participants, attemptIds) {
  if (scenario === 'login') return { consistent: true, verification: 'login creates no exam data' };
  const placeholders = attemptIds.map(() => '?').join(',');
  const [rows] = await db.execute(
    `SELECT a.public_id,a.status,
       COUNT(DISTINCT v.question_id) written_versions,
       MAX(v.revision) latest_revision,
       COUNT(DISTINCT ans.question_id) stored_answers,
       MAX(ans.answer) saved_answer,
       COUNT(DISTINCT r.id) result_count,
       MAX(r.question_count) question_count,
       MAX(r.blank_count+r.correct_count+r.wrong_count) classified_questions,
       MAX(r.earned_points) earned_points,
       MAX(r.maximum_points) maximum_points,
       MAX(r.score) score
     FROM exam_attempts a
     LEFT JOIN answer_write_versions v ON v.attempt_id=a.id
     LEFT JOIN student_answers ans ON ans.attempt_id=a.id
     LEFT JOIN exam_results r ON r.attempt_id=a.id
     WHERE a.public_id IN (${placeholders})
     GROUP BY a.id,a.public_id,a.status`, attemptIds,
  );
  const byId = new Map(rows.map((row) => [row.public_id, row]));
  const missing = attemptIds.filter((id) => !byId.has(id)).length;
  const bad = [];
  for (const participant of participants) {
    const attempt = byId.get(participant.attempt.attempt_id);
    if (!attempt) continue;
    if (Number(attempt.written_versions) !== 1 || Number(attempt.stored_answers) !== 1) bad.push('answer_count');
    const expectedRevision = scenario.startsWith('autosave') ? 2 : participant.acknowledgedRaceAnswer ? 2 : 1;
    const revisionMatches = participant.raceOutcomeUnknown
      ? [1, 2].includes(Number(attempt.latest_revision))
      : Number(attempt.latest_revision) === expectedRevision;
    if (!revisionMatches) bad.push('answer_revision');
    if (participant.acknowledgedRaceAnswer !== undefined && attempt.saved_answer !== participant.acknowledgedRaceAnswer) bad.push('acknowledged_race_answer_missing');
    if (participant.baselineAnswer !== undefined && ![participant.baselineAnswer, participant.expectedRaceAnswer].includes(attempt.saved_answer)) bad.push('race_answer_state');
    if (scenario === 'autosave' && (attempt.status !== 'IN_PROGRESS' || Number(attempt.result_count) !== 0)) bad.push('unexpected_result');
    if (['submit', 'autosave_finalized'].includes(scenario) && (!['COMPLETED', 'EXPIRED', 'TERMINATED'].includes(attempt.status) || Number(attempt.result_count) !== 1 || Number(attempt.classified_questions) !== Number(attempt.question_count) || Number(attempt.score) < 0 || Number(attempt.score) > 100 || Number(attempt.earned_points) < 0 || Number(attempt.earned_points) > Number(attempt.maximum_points))) bad.push('submit_result_state');
  }
  return {
    consistent: missing === 0 && bad.length === 0,
    expected_attempts: attemptIds.length,
    found_attempts: rows.length,
    missing_attempts: missing,
    verified_answered_attempts: rows.filter((row) => Number(row.written_versions) === 1 && Number(row.stored_answers) === 1).length,
    verified_result_attempts: ['submit', 'autosave_finalized'].includes(scenario) ? rows.filter((row) => Number(row.result_count) === 1 && Number(row.classified_questions) === Number(row.question_count) && Number(row.score) >= 0 && Number(row.score) <= 100 && Number(row.earned_points) >= 0 && Number(row.earned_points) <= Number(row.maximum_points)).length : null,
    integrity_errors: bad.length,
  };
}

main().catch((error) => {
  if (interrupted) console.error('Load test interrupted; requests were aborted. Already-created staging attempts were retained for audit.');
  else console.error(error instanceof Error ? error.message : 'Staging load test failed.');
  process.exitCode = 1;
});

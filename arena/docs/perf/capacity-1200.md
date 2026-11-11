# Capacity profile: 1,200 students per session

Target: arena.man1palembang.sch.id, 4 vCPU, 16 GB RAM, 120 GB OS disk; MySQL and Redis share this VPS. This is a starting
profile, not a production capacity certification. The local benchmark covers
authenticated HTTP autosave/submit and background expiry; login, waiting-room
admission, browser rendering, school networking and the Cloudflare edge still
need a staging rehearsal on the actual server.

## Deployment order

1. Back up MySQL and test restore. Apply `database/migrations/014_session_capacity.sql`
   to the Arena database before deploying the API and worker. It is repeatable.
   Do not run the fresh-database migration script on an existing production DB.
   DDL can take metadata locks: apply outside an active exam.
2. Install from `arena/` with `npm ci`, then `npm run build`.
3. Configure a private Redis with persistence and `noeviction`; see
   `infra/redis-capacity.conf.example`. Use the same REDIS_URL on all processes.
   Secrets remain in the deployment secret store/environment.
4. Review `infra/mysql-16gb.cnf.example` before a scheduled database restart.
   It budgets 6 GB for InnoDB and keeps durable transaction commits enabled.
5. Load environment variables using the existing deployment process, then start
   `infra/ecosystem.config.cjs` with PM2. Paths default to `/srv/arena`.
   It defines three API processes (12 connections each), one finalization worker
   (6 connections, concurrency 4), and one waiting-room worker (4 connections):
   46 application connections maximum, leaving headroom within MySQL's 100.
   API finalizers and waiting workers are disabled in this profile to avoid
   duplicate background workers. Running only the API is not this deployment.
6. Confirm `/health/ready`, all PM2 processes, and a real student save/submit.
   Verify that an expired synthetic attempt receives a result and a LOCKed one
   does not. Monitor worker failures and unresolved expired attempts; API health
   alone does not establish worker readiness.

`termination_action` persists the decision taken at termination. Existing
unresolved TERMINATED attempts are conservatively marked LOCK by migration;
review/reset these through an administrator. Existing results are retained.
Changing the global policy later does not retroactively change a locked attempt.

## Queue and overload behavior

Answers still commit synchronously to MySQL before success is returned. BullMQ
handles background finalization, with deduplicated jobs, bounded concurrency,
five exponential-backoff attempts and graceful worker shutdown. MySQL remains
the source of pending work: a scanner re-enqueues unresolved work after Redis
loss or retry exhaustion. Job completion/failure entries are removed; log and
alert on worker failures. Use dedicated Redis per environment.

The scanner uses separate expiry and termination branches so the existing expiry
index and new `(status,termination_action,expires_at,id)` index can serve their
respective queries. Existing answer and violation indexes are retained without
adding duplicate indexes. The default scan covers 1,500 candidates per tick;
monitor old unresolved attempts so permanently invalid snapshots cannot crowd
out subsequent sessions.

The production API connection queue is bounded at 240 per process. A full queue
returns HTTP 503 with Retry-After rather than accepting unbounded waiting work.
Waiting authorization uses cached Lua scripts (EVALSHA with NOSCRIPT recovery)
and returns only the guard status, avoiding dashboard aggregation on every save.
The existing frontend retries saves/submits with jitter and mutation IDs. Tune
the queue against measured latency, not just request counts.

## Login spreading and auth bulkhead (Tahap 4)

A cohort reaching the login form together no longer hits bcrypt workers and the
shared DB pool as one wave:

- The first student-login request is delayed by a stable NISN phase (last six
  digits mod 3000 ms) plus random 0–3000 ms, spreading 1,200 logins over roughly
  six seconds. The delay is client-side and does not change credentials, session
  lifetime, or server authorization.
- Busy responses (503/429) are retried with full-jitter exponential backoff
  (1/2/4/8/10 s, floor 500 ms, up to 8 attempts). The server's `Retry-After`
  header (seconds or HTTP date) is honored when longer.
- Student login queries use a lazy, dedicated auth pool
  (`AUTH_DB_POOL_SIZE=4`, `AUTH_DB_QUEUE_LIMIT=240` per API process) instead of
  the main exam pool. A login burst therefore cannot consume connections needed
  by autosave, submit, or result polling. Finalization and waiting workers never
  open auth connections because the pool is created on first use.
- The main pool remains 12 connections per API process. The production profile
  now budgets `3 × (12 + 4) + 6 + 4 = 58` application connections, still within
  MySQL's 100-connection example profile. Measure pool wait and 503 rates before
  raising either pool size.

Login diagnostics remain opt-in (`ARENA_LOGIN_DIAGNOSTICS=true`) and never log
NISN or PIN. Load-shape diagnostics (`ARENA_LOAD_DIAGNOSTICS=true`) cover
claim/submit/result/SSE behavior. Do not run the capacity harness against
production student data.

## Cloudflare CDN

The zone has not been changed. `infra/cloudflare-cache-rules.json` contains rule
fragments scoped to arena.man1palembang.sch.id: merge with existing zone rules and
keep the dynamic bypass after the asset rule. Do not replace an existing zone
ruleset blindly. Enable proxied DNS and Full (strict) TLS with a valid origin
certificate. Retain authenticated origin access controls already in place.

Include `infra/nginx-static.conf` in the existing server block with its root set
to `apps/web/dist`. Only public Vite assets under `/assets/` receive a one-year
immutable TTL. Keep prior hashed assets available while students have an older
page open. HTML revalidates; APIs, authentication, health endpoints and uploaded
question images bypass CDN caching. Do not enable Cache Everything or browser
challenges on student API requests. Do not trust arbitrary forwarded IP headers;
configure trusted proxies only for the actual origin topology.

After deployment check repeated anonymous asset requests for `CF-Cache-Status:
HIT`. Check authenticated exam and result responses for no-store and absence of
cache hits, including requests made by two different students.

## Repeatable local load test

Use a disposable local MySQL database whose name ends in `_test`, a dedicated
local Redis and Node 22+. From `arena/`, export DATABASE_URL and REDIS_URL, apply
fresh schema with `node scripts/migrate-local.mjs`, then build the API.

```sh
CAPACITY_STUDENTS=100 node scripts/capacity-local.mjs
CAPACITY_STUDENTS=300 node scripts/capacity-local.mjs
CAPACITY_STUDENTS=600 node scripts/capacity-local.mjs
CAPACITY_STUDENTS=1200 CAPACITY_ROUND_DELAY_MS=3000 CAPACITY_REPORT=/tmp/arena-1200.json node scripts/capacity-local.mjs
CAPACITY_STUDENTS=1500 node scripts/capacity-local.mjs
```

The harness defaults to three API processes, distributing requests directly
across three loopback ports (not through Nginx). Use CAPACITY_API_PROCESSES=1
for a single-process baseline. CAPACITY_WAITING_STATE=cold exercises the durable
claim fallback after Redis state loss; default warm restores the waiting state
before measured requests. CAPACITY_ROUND_DELAY_MS=3000 models the frontend's
minimum batching interval; default 0 deliberately bursts all rounds.

Each run creates synthetic students and attempts without deleting existing data.
It sends three rounds of ten-answer batches per student, bursts submit for half
the population, and expires the rest for the MySQL scanner and BullMQ worker.
Assertions require every answer revision and final score to match. Retries and
latencies include backoff. Stop on assertion failure. Remove only the disposable
test containers/databases when finished.

Before production acceptance also test 1,200 logins and admission, reconnects,
Redis/worker restart, real question payloads, and at least one full-length exam
with concurrent staff dashboards on staging. Record CPU, RSS, Redis memory,
DB connections/lock waits, p95/p99, HTTP errors and unresolved result backlog.
No acknowledged answer loss and no duplicate/inconsistent result are mandatory.
Initial latency goals: autosave p95 <=500 ms, p99 <=2 s; submit p95 <=3 s.

## Known pre-existing test failures

Two `attempt-reset.test.mjs` cases expect rejection despite a historical violation
leaving positive remaining time. Both fail against the original HEAD implementation
as well as this branch. They are not treated as passing; the reset-time policy
needs separate reconciliation with those expectations.

## Local measurements (10 November 2026)

The cloud executor had a 4-vCPU quota and a 32-GB memory ceiling, not the target
16-GB VPS. Three Node API processes, local MariaDB 11, Redis 7 and a four-way
BullMQ consumer were used. Requests were distributed directly across API ports.
These measurements are not a production SLA or an end-to-end exam benchmark.

| Population / scenario | Autosave p95 / p99 | Submit p95 | Overload retries | Verified results |
| --- | --- | --- | --- | --- |
| 1,200, cold Redis state, 1 API | 2,647 / 3,749 ms | 2,592 ms | 1,226 | 1,200 |
| 1,200, cold Redis state, 3 APIs | 1,122 / 2,414 ms | 653 ms | 177 | 1,200 |
| 1,200, warm Redis, immediate batch rounds | 837 / 871 ms | 656 ms | 0 | 1,200 |
| 1,200, warm Redis, 3-second batch intervals | 38 / 74 ms | 748 ms | 0 | 1,200 |
| 1,500, warm Redis, 3-second batch intervals | 45 / 96 ms | 869 ms | 0 | 1,500 |

Each 1,200-student run checked 3,600 HTTP batch requests, 600 simultaneous HTTP
submits and 600 background finalizations, with 12,000 unique answer rows at
revision 3 and all scores equal to the expected 100. No integrity assertion
failed. The immediate burst still misses the initial 500-ms autosave p95 goal;
keep this failure mode visible rather than treating the paced result as universal.

Validation: API frozen install and TypeScript build; 33 focused API/BullMQ tests;
14 waiting-room unit/HTTP/MySQL/Redis tests; a real-MySQL termination/LOCK test;
and cached-Lua recovery after SCRIPT FLUSH. Migration 014 was applied twice
successfully. EXPLAIN selected idx_arena_attempt_finalization for the termination
branch and idx_arena_attempt_expiry for the expiry branch. Two pre-existing reset
tests still fail as described above. Cloudflare edge behavior and production
configuration activation remain unverified.

The earlier audit findings on staff-session revocation and SSO browser binding
are outside this capacity patch and remain open; this is not a security sign-off.

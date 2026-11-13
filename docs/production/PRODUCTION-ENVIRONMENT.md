# PRODUCTION ENVIRONMENT CONFIGURATION SPECIFICATION
## MANSAPA ARENA ENVIRONMENT VARIABLE MANIFEST

> **SECURITY NOTICE**:  
> In accordance with zero-trust security standards, all passwords, private keys, API secrets, and encryption keys are strictly **REDACTED** (`<REDACTED>`).  
> Configuration parameters documented here reflect the authoritative production baseline required by the Node runtime and PM2 process ecosystem.

---

## 1. CORE SERVER & RUNTIME SETTINGS

| Variable Name | Purpose | Required? | Actual Value / Type | Secret? | Configuration Source |
|---|---|---|---|---|---|
| `NODE_ENV` | Sets execution mode to production | Yes | `production` | No | PM2 `ecosystem.config.cjs` |
| `HOST` | Loopback bind address for Fastify | Yes | `127.0.0.1` | No | `.env` / Process default |
| `PORT` | HTTP port per cluster instance | Yes | `3001`, `3002`, `3003` | No | PM2 instance loop |
| `LOG_LEVEL` | Fastify console log verbosity | Yes | `warn` (Minimizes disk I/O) | No | `.env` / PM2 |
| `TRUST_PROXY` | Header trust for X-Forwarded-For | Yes | `true` | No | `.env` (Behind Nginx/CF) |
| `REQUEST_TIMEOUT_MS` | Bounded timeout for API requests | No | `45000` (45s) | No | `server.ts` default |

---

## 2. DATABASE CONFIGURATION (MYSQL 8.X)

| Variable Name | Purpose | Required? | Actual Value / Type | Secret? | Configuration Source |
|---|---|---|---|---|---|
| `DATABASE_URL` | MySQL connection string for app | Yes | `mysql://arena_app:<REDACTED>@127.0.0.1:3306/arena` | **YES** | Server `.env` |
| `DB_POOL_SIZE` | Main connection pool limit per API instance | Yes | `12` | No | `.env` / PM2 |
| `DB_QUEUE_LIMIT` | Maximum pending connection queue in pool | Yes | `240` | No | `.env` / PM2 |
| `AUTH_DB_POOL_SIZE` | Dedicated bulkhead pool for login queries | Yes | `4` | No | `.env` / PM2 |
| `AUTH_DB_QUEUE_LIMIT`| Queue limit for bulkhead auth pool | Yes | `240` | No | `.env` / PM2 |
| `DB_CONNECT_TIMEOUT_MS`| Timeout to establish MySQL socket | No | `10000` (10s) | No | `.env` |

---

## 3. CACHE & QUEUE CONFIGURATION (REDIS 7.X)

| Variable Name | Purpose | Required? | Actual Value / Type | Secret? | Configuration Source |
|---|---|---|---|---|---|
| `REDIS_URL` | Redis connection URI | Yes | `redis://127.0.0.1:6379` | No | `.env` |
| `REDIS_COMMAND_TIMEOUT_MS` | Timeout for individual Redis commands | No | `1000` (1s) | No | `.env` |
| `EXAM_QUESTION_REDIS_TTL_MS`| Redis TTL for question payload cache | Yes | `3600000` (1 hour) | No | `.env` |
| `EXAM_QUESTION_PREWARM` | Pre-populates Redis question cache on admission | Yes | `on` | No | `.env` |
| `EXAM_QUESTION_PREWARM_LOCK_MS`| Anti-stampede distributed lock duration | No | `30000` (30s) | No | `.env` |

---

## 4. ADMISSION & WAITING ROOM TUNING

| Variable Name | Purpose | Required? | Actual Value / Type | Secret? | Configuration Source |
|---|---|---|---|---|---|
| `WAITING_BATCH_SIZE` | Number of students admitted per tick | Yes | `300` | No | `.env` / DB default |
| `WAITING_BATCH_INTERVAL_MS`| Interval between admission waves | Yes | `10000` (10s) | No | `.env` / DB default |
| `WAITING_HEARTBEAT_TIMEOUT_MS`| Heartbeat deadline before marked abandoned | Yes | `120000` (120s) | No | `.env` / DB default |
| `WAITING_CLAIM_TIMEOUT_MS` | Claim window before admission expires | Yes | `180000` (180s) | No | `.env` / DB default |
| `WAITING_WORKER_ENABLED` | Enables internal waiting worker | Yes | `false` in API, `true` in worker | No | PM2 ecosystem |

---

## 5. SUBMISSION & FINALIZATION ENGINE

| Variable Name | Purpose | Required? | Actual Value / Type | Secret? | Configuration Source |
|---|---|---|---|---|---|
| `SUBMIT_ASYNC` | Enables durable async submit via BullMQ | Yes | `on` | No | `.env` / PM2 |
| `FINALIZATION_CONCURRENCY` | Concurrent worker scoring jobs | Yes | `4` | No | `.env` / Worker config |
| `SUBMIT_LEASE_MS` | BullMQ worker fence lease duration | Yes | `60000` (60s) | No | `.env` |
| `SUBMIT_LEASE_MAX_ATTEMPTS` | Maximum retry attempts for stalled scoring | Yes | `5` | No | `.env` |
| `ATTEMPT_FINALIZER_ENABLED` | Reconciler for expired exam attempts | Yes | `false` in API, `true` in worker | No | PM2 ecosystem |

---

## 6. CRYPTOGRAPHY, AUTHENTICATION, & SECRETS

| Variable Name | Purpose | Required? | Actual Value / Type | Secret? | Configuration Source |
|---|---|---|---|---|---|
| `AUTH_TOKEN_SECRET` | HMAC SHA-256 signing key for student/staff tokens | Yes | `<REDACTED>` (Min. 32 chars) | **YES** | Server `.env` |
| `PIN_ENCRYPTION_KEY` | AES-256-GCM symmetric key for reprintable PINs | Yes | `<REDACTED>` (Min. 32 chars) | **YES** | Server `.env` |
| `PASSWORD_VERIFY_WORKERS` | Dedicated bcrypt worker threads | Yes | `2` (Per API process = 6 total) | No | `.env` / PM2 |
| `PASSWORD_VERIFY_QUEUE_LIMIT`| Queue limit for pending login verifications | Yes | `5000` | No | `.env` |
| `SETUP_TOKEN` | One-time initial setup token | No | `<REDACTED>` | **YES** | Server `.env` |

---

## 7. PATHS & EXTERNAL INTEGRATIONS

| Variable Name | Purpose | Required? | Actual Value / Type | Secret? | Configuration Source |
|---|---|---|---|---|---|
| `ARENA_UPLOAD_DIR` | Absolute path for question media storage | Yes | `/srv/arena/storage/question-images` | No | `.env` / Nginx alias |
| `ARENA_WEB_URL` | Public origin URL of the CBT application | Yes | `https://arena.man1palembang.sch.id` | No | `.env` |
| `PORTAL_DATA_BASE_URL`| Base URL for Portal Data SIPADU instance | Yes | `https://sipadu.example.sch.id` | No | `.env` |
| `PORTAL_DATA_SYNC_CLIENT_ID`| Client ID for student sync API | Yes | `<REDACTED>` | **YES** | Server `.env` |
| `PORTAL_DATA_SYNC_CLIENT_SECRET`| Client Secret for student sync API | Yes | `<REDACTED>` | **YES** | Server `.env` |
| `OIDC_ISSUER` | OIDC Issuer endpoint | Yes | `https://sipadu.example.sch.id/oidc` | No | `.env` |
| `OIDC_CLIENT_ID` | OAuth2 Client ID for staff SSO | Yes | `<REDACTED>` | **YES** | Server `.env` |
| `OIDC_REDIRECT_URI` | SSO callback endpoint | Yes | `https://arena.man1palembang.sch.id/auth/sso/callback` | No | `.env` |

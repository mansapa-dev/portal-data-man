# Staging Performance Test Plan — 1,200 Concurrent Students

> **CRITICAL:** Never run load tests against production or live students. Run only on staging.

## 1. Target Profile
- **Concurrent active students:** 1,200
- **Exam duration:** 120 minutes
- **Recording segment interval:** 60 seconds (~20 requests/second steady-state presigned URL issuance + 20 PATCH confirmations/second across 1,200 students)
- **Video bytes path:** Direct browser-to-Linode Object Storage (`PUT` via short-lived presigned URL) — **zero video bytes through Node.js API**
- **Security event batching:** Max 1 batch every 10s per student when events occur (no per-frame DB writes)

## 2. Staging Prerequisites
1. Staging MySQL with migrations `001`–`025` applied.
2. Staging Redis instance active.
3. Separate staging S3 bucket (e.g., `arena-recordings-staging`) with CORS allowing `PUT` from staging origin.
4. `RECORDING_ENABLED=true` on staging only.

## 3. Load Test Scenarios
1. **Preflight & Session Creation Burst:** 1,200 virtual students call `POST /api/student/exams/:id/device-session` and `POST /api/student/exams/:id/recording/session` over a 60-second ramp.
2. **Steady-State Segment Lifecycle:** 20 req/s `POST /recording/segment` + 20 req/s `PATCH /recording/segment/:segmentId` for 15 minutes.
3. **Security Event Ingestion Burst:** 200 req/s `POST /security/events` (batches of 5 events) simulating tab switches / network fluctuations.
4. **Staff Live Monitoring:** 10 concurrent staff polling `GET /api/teacher/live-sessions-v2` every 45 seconds.
5. **Cleanup Worker:** Run `CLEANUP_DRY_RUN=true node dist/recording-cleanup-worker.js` and verify batch bounds and `legal_hold` exclusions.

## 4. Pass Criteria
- API p95 latency < 250 ms for `recording/segment` and `security/events`.
- Node.js event loop delay p99 < 50 ms.
- Zero MySQL connection pool exhaustion or lock-wait timeouts.
- Zero out-of-memory errors.

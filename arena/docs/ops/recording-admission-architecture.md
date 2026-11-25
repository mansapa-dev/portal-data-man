# Arena CBT — Mandatory Camera & Recording Admission Architecture

> **PRODUCTION WARNING:** Do not set `RECORDING_ENABLED=true` in production until all staging validation steps below have been completed and a controlled operational rollout is approved.

## 1. Admission Sequence (Fail-Closed)
1. **Policy Check (`GET /api/student/recording/policy`)**: Frontend always fetches server policy. Missing/failed policy blocks exam entry.
2. **Camera & Recorder Preflight (`ExamPreflight.tsx`)**:
   - Verifies HTTPS secure context, `getUserMedia`, live video track, `MediaRecorder` + supported MIME type, `IndexedDB` persistence, and runs a live `MediaRecorder.start()/stop()` probe when recording is required.
   - Camera stream is kept alive and passed into `StudentExam` (never stopped and re-opened unnecessarily).
3. **Waiting-Room Join / Resume / Claim**:
   - `/waiting/join`, `/waiting/resume`, and `/waiting/claim` enforce `assertRecordingReadyForAdmission()`.
   - When `RECORDING_REQUIRED=true`, admission is rejected (`503`) if `RECORDING_ENABLED=false` or object storage is operationally unreachable.
4. **Atomic Attempt + Recording Session Commit (`StudentExamService.startOnce`)**:
   - `ensureRecordingSessionInTransaction()` executes inside the same MySQL transaction as `exam_attempts`, `attempt_questions`, and `exam_waiting_claims`.
   - If recording-session setup fails (e.g., `FINALIZED` session), the entire MySQL transaction rolls back and `waiting.claim()` aborts the Redis claim lease — preventing orphaned `IN_EXAM` states.
   - On crash/retry with the same admission token, `waiting.claim()` recovers from `exam_waiting_claims`, preserves the original `expires_at` timer, and idempotently resumes the `ACTIVE` (or `INTERRUPTED` -> `ACTIVE`) recording session.

## 2. Storage Readiness Semantics
- `storage_configured`: S3 credentials/endpoint/bucket env vars are present.
- `storage_available`: Bounded, single-flight cached `HeadBucketCommand` (2.5s timeout; 30s healthy TTL, 10s unhealthy TTL).
- **What it proves**: Endpoint reachability and bucket access permissions without creating objects or issuing per-student S3 requests (safe for 1,200+ concurrent students).
- **What it does NOT prove**: Individual browser CORS `PUT` success or per-student cellular network stability (handled by `upload-queue.ts` + `HeadObject` confirmation).

## 3. Recording Lifecycle & Finalization
- Segments (60s target, video-only, no audio) are persisted to `IndexedDB` before direct presigned `PUT` upload.
- `PATCH /recording/segment/:segmentId` verifies object existence and `contentLength > 0` via `HeadObject` before marking `UPLOADED`.
- On submit/expiry, `recorder.stopAndFlush()` emits the final segment, `uploadQueue.flush(15_000)` waits with a bounded timeout, and `POST /recording/finalize` records `FINALIZED` or `INTERRUPTED` (retaining failed segments in `IndexedDB`).
- `recording-cleanup-worker.ts` aborts with exit code `1` if object storage is unavailable and never marks unverified deletions as complete.

## 4. Browser Compatibility Limitations
- **iOS Safari**: Fullscreen API is restricted on iPhone; `MediaRecorder` support depends on iOS version and H.264/MP4 support.
- **Mobile Backgrounding**: OS suspension may pause `MediaRecorder`; `IndexedDB` preserves completed segments across reloads, while active in-memory chunks at sudden OS termination cannot be guaranteed.

## 5. Safe Staging Validation Procedure
1. Verify migrations `021`–`025` are applied on staging MySQL.
2. Configure staging `.env` with `RECORDING_ENABLED=true`, `RECORDING_REQUIRED=true`, and staging S3 credentials (with `PUT` CORS enabled for the staging origin).
3. Build (`npm run build`) and restart staging API/worker services.
4. Test: (a) `RECORDING_REQUIRED=true` + `RECORDING_ENABLED=false` blocks entry (`503`); (b) valid preflight + claim creates `exam_attempts` + `exam_recording_sessions` atomically; (c) segment upload + `HeadObject` confirmation + staff playback; (d) `CLEANUP_DRY_RUN=true node dist/recording-cleanup-worker.js`.

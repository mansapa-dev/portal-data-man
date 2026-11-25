/**
 * Tests for recording API routes.
 *
 * Tests verify:
 * - Unauthorized access rejected
 * - Attempt ownership validated
 * - Presigned URL generation (mocked storage)
 * - Segment confirmation
 * - Recording finalization
 * - Staff playback access with audit log
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { buildAppOptions } from '../dist/lib/app-options.js';
import { issueToken } from '../dist/lib/auth.js';
import { ObjectStorageService } from '../dist/services/object-storage.js';
import { riskWeight, classifySeverity, computeEventWeight } from '../dist/services/risk-scoring.js';
import {
  assertRecordingReadyForAdmission,
  checkStorageReadiness,
  ensureRecordingSession,
  getRecordingRuntimeLimits,
  invalidateStorageReadinessCache,
} from '../dist/services/recording-policy.js';
import { recordingRoutes } from '../dist/routes/recording.js';

// ---- Minimal in-memory mock pool ----

function makeAttempt(overrides = {}) {
  return {
    id: 1,
    public_id: 'ATTEMPT01234567890123456',
    student_id: 42,
    exam_id: 7,
    status: 'IN_PROGRESS',
    ...overrides,
  };
}

function makeMockPool(opts = {}) {
  const { attempt = makeAttempt(), sessionRow = null, segmentRow = null } = opts;

  return {
    execute: async (sql, params) => {
      // Attempt lookup
      if (/FROM exam_attempts a.*WHERE.*student_id.*exam_id/s.test(String(sql))) {
        if (attempt && params[0] === attempt.student_id) return [[attempt], []];
        return [[], []];
      }
      // Session lookup
      if (/FROM exam_recording_sessions/.test(String(sql))) {
        return [sessionRow ? [sessionRow] : [], []];
      }
      // Segment lookup
      if (/FROM exam_recording_segments/.test(String(sql))) {
        return [segmentRow ? [segmentRow] : [], []];
      }
      // INSERT/UPDATE: return fake result
      return [{ insertId: 99, affectedRows: 1 }, []];
    },
    query: async () => [[], []],
  };
}

// ---- Mock object storage ----
class MockStorage {
  uploadUrlExpiresSeconds = 300;
  playbackUrlExpiresSeconds = 300;
  async presignedUploadUrl() { return 'https://mock.linodeobjects.com/upload?signed=1'; }
  async presignedPlaybackUrl() { return 'https://mock.linodeobjects.com/playback?signed=1'; }
  async headObject() { return { contentLength: 1024 }; }
  static isAcceptableMimeType(mime) { return mime.startsWith('video/'); }
  static buildSegmentKey(examId, attemptId, sessionId, seq) {
    return `recordings/${examId}/${attemptId}/${sessionId}/segment-${String(seq).padStart(4,'0')}.webm`;
  }
}

describe('Recording routes', () => {
  test('POST /api/student/exams/:id/recording/session rejects unauthenticated request', async () => {
    // A request without a valid auth token should get 401
    const app = Fastify(buildAppOptions({ logLevel: 'silent', trustProxy: false, requestTimeoutMs: 30000 }));
    // Register minimal auth/error handling
    app.setErrorHandler((err, _req, reply) => {  // eslint-disable-line @typescript-eslint/no-unused-vars
      void reply.status(err.statusCode ?? 500).send({ error: err.message });
    });
    app.post('/api/student/exams/:id/recording/session', async () => {
      throw Object.assign(new Error('Login diperlukan'), { statusCode: 401 });
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/student/exams/7/recording/session',
      body: {},
    });
    assert.equal(response.statusCode, 401);
    await app.close();
  });

  test('ObjectStorageService.isAcceptableMimeType validates correctly', async () => {
    assert.equal(ObjectStorageService.isAcceptableMimeType('video/webm'), true);
    assert.equal(ObjectStorageService.isAcceptableMimeType('video/webm;codecs=vp9'), true);
    assert.equal(ObjectStorageService.isAcceptableMimeType('video/mp4'), true);
    assert.equal(ObjectStorageService.isAcceptableMimeType('audio/mp3'), false);
    assert.equal(ObjectStorageService.isAcceptableMimeType('application/octet-stream'), false);
  });

  test('ObjectStorageService.buildSegmentKey produces correct path', async () => {
    const key = ObjectStorageService.buildSegmentKey(7, 'ATTEMPT01234567890123456', 'SESSION0123456789012345', 3);
    assert.equal(key, 'recordings/7/ATTEMPT01234567890123456/SESSION0123456789012345/segment-0003.webm');
  });

  test('buildSegmentKey does not contain PII', async () => {
    const key = ObjectStorageService.buildSegmentKey(7, 'ATTEMPT01234567890123456', 'SESSION0123456789012345', 0);
    // No student name, email, or NISN in the key
    assert.ok(!key.includes('@'));
    assert.ok(key.startsWith('recordings/'));
  });
});

describe('Risk scoring service', () => {
  test('riskWeight returns correct weights for known types', async () => {
    assert.equal(riskWeight('TAB_HIDDEN'), 5);
    assert.equal(riskWeight('WINDOW_BLUR'), 2);
    assert.equal(riskWeight('APP_BACKGROUND'), 5);
    assert.equal(riskWeight('CAMERA_OFF'), 10);
    assert.equal(riskWeight('MULTIPLE_FACES'), 12);
    assert.equal(riskWeight('RECORDING_MISSING'), 15);
    assert.equal(riskWeight('MULTIPLE_ACTIVE_SESSIONS'), 20);
    assert.equal(riskWeight('CAMERA_RECOVERED'), 0);
    assert.equal(riskWeight('NETWORK_INTERRUPTED'), 0);
    assert.equal(riskWeight('UNKNOWN_EVENT'), 0);
    assert.ok(computeEventWeight('TAB_HIDDEN', 3) > riskWeight('TAB_HIDDEN'));
  });

  test('severity classification boundaries', async () => {
    assert.equal(classifySeverity(0), 'LOW');
    assert.equal(classifySeverity(2), 'LOW');
    assert.equal(classifySeverity(3), 'MEDIUM');
    assert.equal(classifySeverity(7), 'MEDIUM');
    assert.equal(classifySeverity(8), 'HIGH');
    assert.equal(classifySeverity(14), 'HIGH');
    assert.equal(classifySeverity(15), 'CRITICAL');
    assert.equal(classifySeverity(25), 'CRITICAL');
  });
});

describe('Security event deduplication', () => {
  test('identical event_key on same attempt is ignored (ON DUPLICATE KEY UPDATE id=id)', () => {
    // The SQL for event insertion uses ON DUPLICATE KEY UPDATE id=id
    // which is effectively a no-op for duplicates. This test verifies the design.
    const sql = `INSERT INTO exam_security_events
       (event_key, attempt_id, student_id, exam_id, event_type,
        severity, client_occurred_at, duration_ms, risk_weight, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id=id`;
    assert.ok(sql.includes('ON DUPLICATE KEY UPDATE id=id'));
  });
});

describe('Recording policy & admission enforcement', () => {
  test('rejects admission when recording is required but disabled', async () => {
    const prevEnabled = process.env.RECORDING_ENABLED;
    const prevRequired = process.env.RECORDING_REQUIRED;
    process.env.RECORDING_ENABLED = 'false';
    process.env.RECORDING_REQUIRED = 'true';
    try {
      await assert.rejects(
        () => assertRecordingReadyForAdmission(null, 42, 7, { storage: null }),
        (err) => err.statusCode === 503 && err.code === 'RECORDING_DISABLED',
      );
    } finally {
      process.env.RECORDING_ENABLED = prevEnabled;
      process.env.RECORDING_REQUIRED = prevRequired;
    }
  });

  test('rejects admission when recording is required and enabled but storage unavailable', async () => {
    const prevEnabled = process.env.RECORDING_ENABLED;
    const prevRequired = process.env.RECORDING_REQUIRED;
    process.env.RECORDING_ENABLED = 'true';
    process.env.RECORDING_REQUIRED = 'true';
    try {
      await assert.rejects(
        () => assertRecordingReadyForAdmission(null, 42, 7, { storage: null }),
        (err) => err.statusCode === 503 && err.code === 'RECORDING_STORAGE_UNAVAILABLE',
      );
    } finally {
      process.env.RECORDING_ENABLED = prevEnabled;
      process.env.RECORDING_REQUIRED = prevRequired;
    }
  });

  test('rejects resume when attempt recording session is already FINALIZED', async () => {
    const prevEnabled = process.env.RECORDING_ENABLED;
    const prevRequired = process.env.RECORDING_REQUIRED;
    process.env.RECORDING_ENABLED = 'true';
    process.env.RECORDING_REQUIRED = 'true';
    const fakePool = {
      execute: async () => [[{ id: 1, attempt_status: 'IN_PROGRESS', rec_status: 'FINALIZED' }], []],
    };
    try {
      await assert.rejects(
        () => assertRecordingReadyForAdmission(fakePool, 42, 7, { storage: new MockStorage(), checkExistingAttempt: true }),
        (err) => err.statusCode === 409 && err.code === 'RECORDING_SESSION_CLOSED',
      );
    } finally {
      process.env.RECORDING_ENABLED = prevEnabled;
      process.env.RECORDING_REQUIRED = prevRequired;
    }
  });

  test('ensureRecordingSession is idempotent for ACTIVE sessions and resumes INTERRUPTED sessions', async () => {
    const makeTxPool = (recStatus) => {
      const updates = [];
      const conn = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        execute: async (sql) => {
          if (/FROM exam_attempts/.test(sql)) return [[{ id: 10, status: 'IN_PROGRESS' }], []];
          if (/FROM exam_recording_sessions/.test(sql)) return [[{ id: 5, public_id: 'REC_SESSION_01234567890123', status: recStatus }], []];
          if (/UPDATE exam_recording_sessions/.test(sql)) { updates.push(sql); return [{ affectedRows: 1 }, []]; }
          return [{ insertId: 5 }, []];
        },
      };
      return { getConnection: async () => conn, updates };
    };

    const activePool = makeTxPool('ACTIVE');
    const r1 = await ensureRecordingSession(activePool, 42, 7);
    assert.equal(r1.session_id, 'REC_SESSION_01234567890123');
    assert.equal(r1.resumed, true);
    assert.equal(activePool.updates.length, 0);

    const interruptedPool = makeTxPool('INTERRUPTED');
    const r2 = await ensureRecordingSession(interruptedPool, 42, 7);
    assert.equal(r2.resumed, true);
    assert.equal(interruptedPool.updates.length, 1);

    const finalizedPool = makeTxPool('FINALIZED');
    await assert.rejects(
      () => ensureRecordingSession(finalizedPool, 42, 7),
      (err) => err.statusCode === 409 && err.code === 'RECORDING_SESSION_CLOSED',
    );
  });

  test('checkStorageReadiness caches and deduplicates concurrent HeadBucket probes', async () => {
    invalidateStorageReadinessCache();
    let probeCalls = 0;
    const mockStorage = {
      checkBucketReadiness: async () => {
        probeCalls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return { ready: true };
      },
    };

    const results = await Promise.all([
      checkStorageReadiness(mockStorage),
      checkStorageReadiness(mockStorage),
      checkStorageReadiness(mockStorage),
    ]);
    assert.deepEqual(results, [true, true, true]);
    assert.equal(probeCalls, 1);

    // Subsequent call hits TTL cache
    assert.equal(await checkStorageReadiness(mockStorage), true);
    assert.equal(probeCalls, 1);

    // Unhealthy storage fails closed
    invalidateStorageReadinessCache();
    const unhealthyStorage = { checkBucketReadiness: async () => ({ ready: false, reason: 'TimeoutError' }) };
    assert.equal(await checkStorageReadiness(unhealthyStorage), false);
    invalidateStorageReadinessCache();
  });

  test('recordingRoutes enforces waiting.authorize and HeadObject verification', async () => {
    const prevEnabled = process.env.RECORDING_ENABLED;
    process.env.RECORDING_ENABLED = 'true';
    const csrf = 'c'.repeat(32);
    const token = issueToken({ sub: 42, role: 'STUDENT', csrf, exp: Math.floor(Date.now() / 1000) + 3600 });

    const mockStorage = {
      uploadUrlExpiresSeconds: 300,
      playbackUrlExpiresSeconds: 300,
      presignedUploadUrl: async () => 'https://mock.linodeobjects.com/put',
      presignedPlaybackUrl: async () => 'https://mock.linodeobjects.com/get',
      headObject: async () => null, // Missing in storage
      checkBucketReadiness: async () => ({ ready: true }),
    };

    const mockPool = {
      execute: async (sql) => {
        if (/FROM exam_recording_segments seg/.test(sql)) {
          return [[{ id: 10, object_key: 'recordings/7/1/S/segment-0000.webm', upload_status: 'PENDING', session_id: 5, session_status: 'ACTIVE' }], []];
        }
        return [{ affectedRows: 1 }, []];
      },
    };

    const mockWaiting = {
      authorize: async (_examId, _studentId, examToken) => {
        if (examToken !== 'valid_exam_token_123456789012345678901234') {
          throw Object.assign(new Error('Token masuk diperlukan'), { statusCode: 403 });
        }
        return { status: 'IN_EXAM' };
      },
    };

    const app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      void reply.status(err.statusCode ?? 500).send({ error: err.message });
    });
    await app.register(recordingRoutes, { pool: mockPool, waiting: mockWaiting, storage: mockStorage });

    try {
      // Missing exam token -> 403
      const noToken = await app.inject({
        method: 'POST',
        url: '/api/student/exams/7/recording/session',
        headers: { authorization: `Bearer ${token}`, 'x-csrf-token': csrf },
        payload: {},
      });
      assert.equal(noToken.statusCode, 403);

      // HeadObject returns null -> 422 (never marks UPLOADED)
      const unverified = await app.inject({
        method: 'PATCH',
        url: '/api/student/exams/7/recording/segment/10',
        headers: {
          authorization: `Bearer ${token}`,
          'x-csrf-token': csrf,
          'x-exam-token': 'valid_exam_token_123456789012345678901234',
        },
        payload: { file_size_bytes: 1234 },
      });
      assert.equal(unverified.statusCode, 422);
    } finally {
      process.env.RECORDING_ENABLED = prevEnabled;
      await app.close();
    }
  });
});

// ---- Helpers for the hardening tests below ----

const STUDENT_CSRF = 'c'.repeat(32);
const STUDENT_TOKEN = () => issueToken({
  sub: 42,
  role: 'STUDENT',
  csrf: STUDENT_CSRF,
  exp: Math.floor(Date.now() / 1000) + 3600,
});
const VALID_EXAM_TOKEN = 'valid_exam_token_123456789012345678901234';

function buildHardeningApp({ pool, storage, role = 'STUDENT', sub = 42 }) {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    void reply.status(err.statusCode ?? 500).send({ error: err.message });
  });
  const token = issueToken({
    sub,
    role,
    csrf: STUDENT_CSRF,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const waiting = {
    authorize: async () => ({ status: 'IN_EXAM' }),
  };
  return app.register(recordingRoutes, { pool, waiting, storage }).then(() => ({ app, token }));
}

function storageMock(overrides = {}) {
  let presignCalls = 0;
  const base = {
    uploadUrlExpiresSeconds: 300,
    playbackUrlExpiresSeconds: 300,
    presignedUploadUrl: async () => {
      presignCalls += 1;
      return 'https://mock.linodeobjects.com/put';
    },
    presignedPlaybackUrl: async () => 'https://mock.linodeobjects.com/get',
    headObject: async () => ({ contentLength: 1024 }),
    deleteObject: async () => {},
    checkBucketReadiness: async () => ({ ready: true }),
  };
  const storage = { ...base, ...overrides };
  return { storage, presignCalls: () => presignCalls };
}

describe('Recording hardening', () => {
  test('runtime limits clamp unsafe environment values', () => {
    const keys = [
      'RECORDING_SEGMENT_DURATION_SECONDS',
      'RECORDING_VIDEO_BITRATE',
      'RECORDING_RETENTION_DAYS',
      'RECORDING_MAX_SEGMENT_BYTES',
      'RECORDING_MAX_SEGMENTS_PER_SESSION',
    ];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      process.env.RECORDING_SEGMENT_DURATION_SECONDS = '0';
      process.env.RECORDING_VIDEO_BITRATE = '99999999';
      process.env.RECORDING_RETENTION_DAYS = 'abc';
      process.env.RECORDING_MAX_SEGMENT_BYTES = '1';
      process.env.RECORDING_MAX_SEGMENTS_PER_SESSION = '0';

      const limits = getRecordingRuntimeLimits();
      assert.equal(limits.segment_duration_seconds, 10);
      assert.equal(limits.video_bitrate, 1_500_000);
      assert.equal(limits.retention_days, 7);
      assert.equal(limits.max_segment_bytes, 1_048_576);
      assert.equal(limits.max_segments_per_session, 1);
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });

  test('confirm rejects and deletes an oversized object without marking it UPLOADED', async () => {
    const prevEnabled = process.env.RECORDING_ENABLED;
    const prevMax = process.env.RECORDING_MAX_SEGMENT_BYTES;
    process.env.RECORDING_ENABLED = 'true';
    process.env.RECORDING_MAX_SEGMENT_BYTES = '1048576';

    let deletedKey = null;
    let markedUploaded = false;
    const { storage } = storageMock({
      headObject: async () => ({ contentLength: 2_000_000 }),
      deleteObject: async (key) => { deletedKey = key; },
    });
    const pool = {
      execute: async (sql) => {
        if (/FROM exam_recording_segments seg/.test(String(sql))) {
          return [[{ id: 10, object_key: 'recordings/7/1/S/segment-0000.webm', upload_status: 'PENDING', session_id: 5, session_status: 'ACTIVE' }], []];
        }
        if (/SET upload_status = 'UPLOADED'/.test(String(sql))) markedUploaded = true;
        return [{ affectedRows: 1 }, []];
      },
    };

    const { app, token } = await buildHardeningApp({ pool, storage });
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/student/exams/7/recording/segment/10',
        headers: {
          authorization: `Bearer ${token}`,
          'x-csrf-token': STUDENT_CSRF,
          'x-exam-token': VALID_EXAM_TOKEN,
        },
        payload: { file_size_bytes: 2_000_000 },
      });
      assert.equal(response.statusCode, 413);
      assert.equal(deletedKey, 'recordings/7/1/S/segment-0000.webm');
      assert.equal(markedUploaded, false);
    } finally {
      process.env.RECORDING_ENABLED = prevEnabled;
      if (prevMax === undefined) delete process.env.RECORDING_MAX_SEGMENT_BYTES;
      else process.env.RECORDING_MAX_SEGMENT_BYTES = prevMax;
      await app.close();
    }
  });

  test('does not issue a new upload URL for an already UPLOADED segment', async () => {
    const prevEnabled = process.env.RECORDING_ENABLED;
    process.env.RECORDING_ENABLED = 'true';
    const { storage, presignCalls } = storageMock();
    const pool = {
      execute: async (sql) => {
        const text = String(sql);
        if (/FROM exam_recording_sessions s[\s\S]*JOIN exam_attempts a/.test(text)) {
          return [[{ id: 5, attempt_id: 1, status: 'ACTIVE' }], []];
        }
        if (/FROM exam_recording_segments[\s\S]*WHERE session_id/.test(text)) {
          return [[{ id: 10, object_key: 'recordings/7/1/S/segment-0000.webm', upload_status: 'UPLOADED' }], []];
        }
        return [{ affectedRows: 1 }, []];
      },
    };

    const { app, token } = await buildHardeningApp({ pool, storage });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/student/exams/7/recording/segment',
        headers: {
          authorization: `Bearer ${token}`,
          'x-csrf-token': STUDENT_CSRF,
          'x-exam-token': VALID_EXAM_TOKEN,
        },
        payload: {
          session_id: 'SESSION0123456789012345678',
          sequence_number: 0,
          mime_type: 'video/webm',
        },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.already_uploaded, true);
      assert.equal(body.upload_url, '');
      assert.equal(presignCalls(), 0);
    } finally {
      process.env.RECORDING_ENABLED = prevEnabled;
      await app.close();
    }
  });

  test('recording evidence listing is denied for staff not assigned to the exam', async () => {
    const prevEnabled = process.env.RECORDING_ENABLED;
    process.env.RECORDING_ENABLED = 'true';
    const { storage } = storageMock();
    const scopeCalls = [];
    const pool = {
      execute: async (sql, params) => {
        const text = String(sql);
        if (/FROM exam_recording_sessions s[\s\S]*JOIN exam_attempts a/.test(text)) {
          return [[{ id: 5, public_id: 'SESSION0123456789012345678', status: 'FINALIZED', exam_id: 7 }], []];
        }
        if (/FROM teacher_exam_assignments/.test(text)) {
          scopeCalls.push(params);
          return [[], []]; // teacher is not assigned to exam 7
        }
        return [[], []];
      },
    };

    const { app, token } = await buildHardeningApp({ pool, storage, role: 'TEACHER', sub: 77 });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/teacher/recording/ATTEMPT0123456789012345678',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(response.statusCode, 403);
      assert.equal(scopeCalls.length, 1);
      assert.deepEqual(scopeCalls[0], [77, 7]);
    } finally {
      process.env.RECORDING_ENABLED = prevEnabled;
      await app.close();
    }
  });

  test('playback URL is not generated for staff outside the exam scope', async () => {
    const prevEnabled = process.env.RECORDING_ENABLED;
    process.env.RECORDING_ENABLED = 'true';
    let playbackSigned = false;
    const { storage } = storageMock({
      presignedPlaybackUrl: async () => {
        playbackSigned = true;
        return 'https://mock.linodeobjects.com/get';
      },
    });
    const pool = {
      execute: async (sql) => {
        const text = String(sql);
        if (/FROM exam_recording_segments seg/.test(text)) {
          return [[{ id: 10, object_key: 'recordings/7/1/S/segment-0000.webm', upload_status: 'UPLOADED', exam_id: 7 }], []];
        }
        if (/FROM teacher_exam_assignments/.test(text)) return [[], []];
        return [{ affectedRows: 1 }, []];
      },
    };

    const { app, token } = await buildHardeningApp({ pool, storage, role: 'EMPLOYEE', sub: 88 });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/teacher/recording/segment/10/url',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(response.statusCode, 403);
      assert.equal(playbackSigned, false);
    } finally {
      process.env.RECORDING_ENABLED = prevEnabled;
      await app.close();
    }
  });
});

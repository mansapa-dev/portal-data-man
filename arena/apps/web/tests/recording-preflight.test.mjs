import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}

async function loadTs(relPath) {
  const source = await readFile(new URL(relPath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const { evaluateRecordingPolicy } = await loadTs('../src/lib/preflight-policy.ts');
const { createUploadQueue } = await loadTs('../src/lib/upload-queue.ts');
const { createExamRecorder } = await loadTs('../src/lib/recorder.ts');

test('evaluateRecordingPolicy fails closed on null/missing policy', () => {
  const res = evaluateRecordingPolicy(null);
  assert.equal(res.allowed, false);
  assert.ok(res.errorMessage.length > 0);
});

test('evaluateRecordingPolicy blocks entry when recording is required but disabled', () => {
  const res = evaluateRecordingPolicy({
    recording_enabled: false,
    recording_required: true,
    storage_available: true,
    segment_duration_seconds: 60,
    video_bitrate: 500_000,
  });
  assert.equal(res.allowed, false);
});

test('evaluateRecordingPolicy blocks entry when recording is required but storage unavailable', () => {
  const res = evaluateRecordingPolicy({
    recording_enabled: true,
    recording_required: true,
    storage_available: false,
    segment_duration_seconds: 60,
    video_bitrate: 500_000,
  });
  assert.equal(res.allowed, false);
});

test('evaluateRecordingPolicy keeps camera preflight mandatory even when recording is disabled', () => {
  const res = evaluateRecordingPolicy({
    recording_enabled: false,
    recording_required: false,
    storage_available: false,
    segment_duration_seconds: 60,
    video_bitrate: 500_000,
  });
  assert.equal(res.allowed, true);
  assert.equal(res.requireCamera, true);
  assert.equal(res.requireRecording, false);
  assert.equal(res.recordingActive, false);
});

test('createUploadQueue fails closed when requireDurablePersistence=true and IndexedDB is unavailable', async () => {
  let storageError = null;
  const queue = createUploadQueue({
    sessionId: 'SESSION0123456789012345678',
    examId: 7,
    requireDurablePersistence: true,
    requestPresignedUrl: async () => ({ upload_url: 'https://example.com', segment_id: 1 }),
    confirmUpload: async () => {},
    onPermanentFailure: () => {},
    onStorageUnavailable: (err) => { storageError = err; },
  });

  const started = await queue.start();
  assert.equal(started, false);
  assert.ok(storageError instanceof Error);
});

test('createUploadQueue retains failed segment on permanent failure and supports retryFailed', async () => {
  let permanentFailures = 0;
  let uploadAttempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    uploadAttempts += 1;
    return { ok: uploadAttempts > 1, status: uploadAttempts > 1 ? 200 : 403 };
  };

  try {
    const queue = createUploadQueue({
      sessionId: 'SESSION0123456789012345678',
      examId: 7,
      requireDurablePersistence: false,
      requestPresignedUrl: async () => ({ upload_url: 'https://example.com/put', segment_id: 11 }),
      confirmUpload: async () => {},
      onPermanentFailure: () => { permanentFailures += 1; },
    });

    await queue.start();
    await queue.enqueue({
      id: 'seg-0',
      blob: new Blob(['video']),
      mimeType: 'video/webm',
      sequenceNumber: 0,
      sessionId: 'SESSION0123456789012345678',
      examId: 7,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });

    const flush1 = await queue.flush(2000);
    assert.equal(flush1.timedOut, false);
    assert.equal(permanentFailures, 1);
    assert.equal(queue.failedCount, 1);

    // Retry failed segment — second attempt succeeds
    queue.retryFailed();
    const flush2 = await queue.flush(2000);
    assert.equal(flush2.timedOut, false);
    assert.equal(queue.failedCount, 0);
    assert.equal(queue.pendingCount, 0);
    queue.stop();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createExamRecorder detects camera track ended and supports stopAndFlush', async () => {
  const listeners = new Map();
  const fakeTrack = {
    readyState: 'live',
    addEventListener: (ev, fn) => listeners.set(ev, fn),
    removeEventListener: (ev) => listeners.delete(ev),
  };
  const fakeStream = { getVideoTracks: () => [fakeTrack] };

  let lastInstance = null;
  const originalMR = globalThis.MediaRecorder;
  globalThis.MediaRecorder = class FakeMediaRecorder {
    constructor() {
      this.state = 'inactive';
      lastInstance = this;
    }
    start() {
      this.state = 'recording';
      setTimeout(() => this.ondataavailable?.({ data: new Blob(['chunk']) }), 5);
    }
    requestData() {}
    stop() {
      this.state = 'inactive';
      this.onstop?.();
    }
  };

  try {
    let errors = 0;
    const segments = [];
    const rec = createExamRecorder({
      stream: fakeStream,
      mimeType: 'video/webm',
      onSegment: (s) => segments.push(s),
      onError: () => { errors += 1; },
      onStopped: () => {},
    });

    rec.start();
    assert.equal(rec.isRecording, true);
    await new Promise((r) => setTimeout(r, 20));
    const flushed = await rec.stopAndFlush();
    assert.ok(flushed !== null);
    assert.equal(segments.length, 1);

    // Simulate track ending on a second recorder
    const rec2 = createExamRecorder({
      stream: fakeStream,
      mimeType: 'video/webm',
      onSegment: () => {},
      onError: () => { errors += 1; },
      onStopped: () => {},
    });
    rec2.start();
    listeners.get('ended')?.();
    assert.equal(errors, 1);
    assert.equal(rec2.isRecording, false);
    assert.ok(lastInstance !== null);
  } finally {
    globalThis.MediaRecorder = originalMR;
  }
});

test('createUploadQueue aborts a stalled PUT and marks it failed after retries', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    fetchCalls += 1;
    const signal = options?.signal;
    const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort);
    }
  });

  try {
    const queue = createUploadQueue({
      sessionId: 'SESSION0123456789012345678',
      examId: 7,
      requireDurablePersistence: false,
      maxRetries: 0,
      uploadTimeoutMs: 20,
      uploadStartJitterMs: 0,
      requestPresignedUrl: async () => ({ upload_url: 'https://example.com/put', segment_id: 12 }),
      confirmUpload: async () => {},
      onPermanentFailure: () => {},
    });

    await queue.start();
    await queue.enqueue({
      id: 'seg-timeout',
      blob: new Blob(['video']),
      mimeType: 'video/webm',
      sequenceNumber: 1,
      sessionId: 'SESSION0123456789012345678',
      examId: 7,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });

    const result = await queue.flush(2000);
    assert.equal(result.timedOut, false);
    assert.equal(result.failed, 1);
    assert.equal(queue.pendingCount, 0);
    assert.ok(fetchCalls >= 1);
    queue.stop();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createUploadQueue skips the PUT when the server reports already_uploaded', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let confirms = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200 };
  };

  try {
    const queue = createUploadQueue({
      sessionId: 'SESSION0123456789012345678',
      examId: 7,
      requireDurablePersistence: false,
      uploadStartJitterMs: 0,
      requestPresignedUrl: async () => ({ upload_url: '', segment_id: 13, already_uploaded: true }),
      confirmUpload: async () => { confirms += 1; },
      onPermanentFailure: () => {},
    });

    await queue.start();
    await queue.enqueue({
      id: 'seg-already-uploaded',
      blob: new Blob(['video']),
      mimeType: 'video/webm',
      sequenceNumber: 2,
      sessionId: 'SESSION0123456789012345678',
      examId: 7,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });

    const result = await queue.flush(2000);
    assert.equal(result.timedOut, false);
    assert.equal(result.pending, 0);
    assert.equal(fetchCalls, 0);
    assert.equal(confirms, 1);
    queue.stop();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

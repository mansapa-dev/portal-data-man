import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { api, ApiError } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const pendingUntilAbort = (signal) => new Promise((_, reject) => {
  const abort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
});

test('a stalled admission request times out so polling can retry', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_path, options) => pendingUntilAbort(options.signal);
  try {
    await assert.rejects(api('/api/student/exams/1/admission', { timeoutMs: 10 }), error => error instanceof ApiError && error.statusCode === 504);
  } finally { globalThis.fetch = original; }
});

test('a stalled response body is also bounded by the request timeout', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_path, options) => ({ ok: true, status: 200, json: () => pendingUntilAbort(options.signal) });
  try {
    await assert.rejects(api('/api/student/exams/1/start', { method: 'POST', body: {}, timeoutMs: 10 }), error => error instanceof ApiError && error.statusCode === 504);
  } finally { globalThis.fetch = original; }
});

test('a completed start returns its data and cancels the abort timer', async () => {
  const original = globalThis.fetch;
  let signal;
  globalThis.fetch = async (_path, options) => { signal = options.signal; return { ok: true, status: 200, json: async () => ({ attempt_id: 'dummy' }) }; };
  try {
    assert.deepEqual(await api('/api/student/exams/1/start', { timeoutMs: 10 }), { attempt_id: 'dummy' });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(signal.aborted, false);
  } finally { globalThis.fetch = original; }
});

test('Retry-After dari server diteruskan ke ApiError untuk backoff login', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    headers: { get: (name) => name === 'retry-after' ? '3' : null },
    json: async () => ({ error: 'Layanan login sedang sibuk' }),
  });
  try {
    await assert.rejects(api('/api/auth/student/login', { method: 'POST', body: {} }), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.retryAfterMs, 3_000);
      return true;
    });
  } finally { globalThis.fetch = original; }
});

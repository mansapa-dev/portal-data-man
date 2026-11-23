import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/face-report.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { createFaceReporter, faceApiStatus } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeTimers() {
  let nextId = 1;
  const jobs = new Map();
  const api = {
    set(callback, delay) {
      const id = nextId++;
      jobs.set(id, { callback, delay });
      return id;
    },
    clear(id) {
      jobs.delete(id);
    },
  };
  const runNext = () => {
    const first = jobs.entries().next().value;
    if (!first) return false;
    const [id, job] = first;
    jobs.delete(id);
    job.callback();
    return true;
  };
  return { api, jobs, runNext, pending: () => jobs.size };
}

test('pemetaan status kamera konsisten dan model-error tidak dikirim', () => {
  assert.equal(faceApiStatus('ok'), 'OK');
  assert.equal(faceApiStatus('absent'), 'ABSENT');
  assert.equal(faceApiStatus('blocked'), 'CAMERA_OFF');
  assert.equal(faceApiStatus('unavailable'), 'CAMERA_OFF');
  assert.equal(faceApiStatus('error'), 'CAMERA_OFF');
  assert.equal(faceApiStatus('starting'), null);
  assert.equal(faceApiStatus('model-error'), null);
});

test('model-error dan starting tidak pernah menghasilkan request', async () => {
  const timers = fakeTimers();
  const sent = [];
  const reporter = createFaceReporter({ send: async (status) => sent.push(status), timer: timers.api });
  reporter.report('model-error');
  reporter.report('starting');
  assert.equal(timers.pending(), 0);
  await tick();
  assert.deepEqual(sent, []);
  reporter.dispose();
});

test('request gagal boleh mengulang status yang sama (tidak dianggap terkirim)', async () => {
  const timers = fakeTimers();
  const delays = [];
  const sent = [];
  let attempt = 0;
  const reporter = createFaceReporter({
    send: async (status) => {
      attempt += 1;
      sent.push(status);
      if (attempt === 1) throw new Error('offline');
    },
    timer: {
      set(callback, delay) {
        delays.push(delay);
        return timers.api.set(callback, delay);
      },
      clear: (id) => timers.api.clear(id),
    },
    random: () => 0,
  });
  reporter.report('absent');
  assert.equal(timers.runNext(), true);
  await tick();
  assert.deepEqual(sent, ['ABSENT']);
  assert.equal(timers.pending(), 1, 'harus menjadwalkan retry');
  assert.ok(delays.includes(2000), 'retry pertama memakai backoff 2 detik');
  assert.equal(timers.runNext(), true);
  await tick();
  assert.deepEqual(sent, ['ABSENT', 'ABSENT'], 'mengulang status yang sama');
  reporter.dispose();
});

test('tidak ada request paralel meski report dipanggil berkali-kali', async () => {
  const timers = fakeTimers();
  const sent = [];
  const resolvers = [];
  const reporter = createFaceReporter({
    send: (status) => {
      sent.push(status);
      return new Promise((resolve) => resolvers.push(resolve));
    },
    timer: timers.api,
  });
  reporter.report('absent');
  reporter.report('absent');
  reporter.report('absent');
  assert.equal(timers.pending(), 1);
  assert.equal(timers.runNext(), true);
  assert.equal(timers.runNext(), false);
  await tick();
  assert.deepEqual(sent, ['ABSENT']);
  resolvers[0]();
  await tick();
  reporter.dispose();
});

test('status terbaru menang: OK tidak tertimpa ABSENT yang masih berjalan', async () => {
  const timers = fakeTimers();
  const sent = [];
  const resolvers = [];
  const reporter = createFaceReporter({
    send: (status) => {
      sent.push(status);
      return new Promise((resolve) => resolvers.push(resolve));
    },
    timer: timers.api,
  });
  reporter.report('absent');
  assert.equal(timers.runNext(), true);
  await tick();
  assert.deepEqual(sent, ['ABSENT']);
  reporter.report('ok');
  assert.equal(timers.pending(), 0, 'status baru menunggu request yang berjalan');
  resolvers[0]();
  await tick();
  assert.equal(timers.pending(), 1, 'OK dijadwalkan setelah ABSENT selesai');
  assert.equal(timers.runNext(), true);
  await tick();
  assert.deepEqual(sent, ['ABSENT', 'OK']);
  reporter.dispose();
});

test('dispose menghentikan retry dan tidak ada pengiriman berikutnya', async () => {
  const timers = fakeTimers();
  let sends = 0;
  const reporter = createFaceReporter({
    send: async () => { sends += 1; throw new Error('offline'); },
    timer: timers.api,
    delays: [10],
    random: () => 0,
  });
  reporter.report('absent');
  assert.equal(timers.runNext(), true);
  await tick();
  assert.equal(sends, 1);
  assert.equal(timers.pending(), 1);
  reporter.dispose();
  assert.equal(timers.pending(), 0);
  await tick();
  assert.equal(sends, 1);
});

test('status yang sudah di-ACK tidak dikirim ulang', async () => {
  const timers = fakeTimers();
  const sent = [];
  const reporter = createFaceReporter({ send: async (status) => sent.push(status), timer: timers.api });
  reporter.report('ok');
  assert.equal(timers.runNext(), true);
  await tick();
  assert.deepEqual(sent, ['OK']);
  reporter.report('ok');
  assert.equal(timers.runNext(), true);
  await tick();
  assert.deepEqual(sent, ['OK']);
  reporter.dispose();
});

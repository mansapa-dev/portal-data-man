import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/load-shape.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { claimDelayMs, submitJitterMs, resultPollDelayMs, autosaveFlushDelayMs } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

test('claim jitter dibatasi interval batch dan maksimum 8 detik', () => {
  assert.equal(claimDelayMs(10_000, () => 0), 0);
  assert.equal(claimDelayMs(10_000, () => 1), 8_000);
  assert.equal(claimDelayMs(3_000, () => 1), 3_000);
  assert.equal(claimDelayMs(0, () => 0.5), 0);
  assert.equal(claimDelayMs(Number.NaN, () => 1), 0);
  for (let i = 0; i < 200; i++) {
    const value = claimDelayMs(10_000);
    assert.ok(value >= 0 && value <= 8_000, `claim delay ${value} di luar batas`);
  }
});

test('auto-submit jitter berada di 0..2000 ms', () => {
  assert.equal(submitJitterMs(() => 0), 0);
  assert.equal(submitJitterMs(() => 1), 2_000);
  for (let i = 0; i < 200; i++) {
    const value = submitJitterMs();
    assert.ok(value >= 0 && value <= 2_000, `submit jitter ${value} di luar batas`);
  }
});

test('poll hasil memakai backoff untuk RECEIVED dan 2 detik untuk PROCESSING', () => {
  assert.equal(resultPollDelayMs(0, 'RECEIVED', () => 0.5), 2_000);
  assert.equal(resultPollDelayMs(2, 'RECEIVED', () => 0.5), 3_000);
  assert.equal(resultPollDelayMs(100, 'RECEIVED', () => 0.5), 10_000);
  assert.equal(resultPollDelayMs(9, 'PROCESSING', () => 0.5), 2_000);
  assert.equal(resultPollDelayMs(0, 'RECEIVED', () => 0), 1_500);
  assert.equal(resultPollDelayMs(0, 'RECEIVED', () => 1), 2_500);
  assert.equal(resultPollDelayMs(-5, 'RECEIVED', () => 0.5), 2_000);
});

test('flush autosave tersebar 2,5–5,5 detik dengan phase stabil per siswa', () => {
  assert.equal(autosaveFlushDelayMs(0, () => 0), 2_500);
  assert.equal(autosaveFlushDelayMs(499, () => 0), 2_999);
  assert.equal(autosaveFlushDelayMs(500, () => 0), 2_500);
  assert.equal(autosaveFlushDelayMs(0, () => 1), 5_000);
  for (let i = 0; i < 200; i++) {
    const value = autosaveFlushDelayMs(i);
    assert.ok(value >= 2_500 && value <= 5_499, `autosave delay ${value} di luar batas`);
  }
});

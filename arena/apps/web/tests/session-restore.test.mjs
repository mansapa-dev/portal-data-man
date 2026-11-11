import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/session-restore.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { restorePlan } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

test('pengunjung anonim tidak memicu request session', () => {
  assert.deepEqual(restorePlan(null), []);
  assert.deepEqual(restorePlan(undefined), []);
  assert.deepEqual(restorePlan(''), []);
});

test('penanda portal menentukan portal yang dicoba lebih dulu', () => {
  assert.deepEqual(restorePlan('student'), ['student', 'staff']);
  assert.deepEqual(restorePlan('staff'), ['staff', 'student']);
});

test('penanda asing diabaikan agar tidak ada probe acak', () => {
  assert.deepEqual(restorePlan('admin'), []);
  assert.deepEqual(restorePlan('STUDENT'), []);
});

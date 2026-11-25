import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Provide minimal globalThis.window shim for Node test environment
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}

const source = await readFile(new URL('../src/lib/security-events.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { createSecurityEventBatcher, makeEventKey } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

test('makeEventKey produces unique keys prefixed with event type', () => {
  const k1 = makeEventKey('TAB_HIDDEN');
  const k2 = makeEventKey('TAB_HIDDEN');
  assert.ok(k1.startsWith('TAB_HIDDEN_'));
  assert.notEqual(k1, k2);
});

test('createSecurityEventBatcher batches and flushes events', async () => {
  const sent = [];
  const batcher = createSecurityEventBatcher({
    attemptId: 'ATTEMPT01234567890123456',
    examId: 7,
    maxBatchSize: 2,
    flushIntervalMs: 60_000,
    send: async (events) => {
      sent.push(events);
    },
  });

  batcher.push({ event_key: makeEventKey('PAGE_SUSPENDED'), event_type: 'PAGE_SUSPENDED' });
  batcher.push({ event_key: makeEventKey('NETWORK_INTERRUPTED'), event_type: 'NETWORK_INTERRUPTED' });
  batcher.push({ event_key: makeEventKey('NETWORK_RECOVERED'), event_type: 'NETWORK_RECOVERED' });

  await batcher.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 2);

  await batcher.flush();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].length, 1);
  batcher.stop();
});

test('createSecurityEventBatcher re-queues events on send failure (bounded)', async () => {
  let attempts = 0;
  const batcher = createSecurityEventBatcher({
    attemptId: 'ATTEMPT01234567890123456',
    examId: 7,
    maxQueueSize: 2,
    flushIntervalMs: 60_000,
    send: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
    },
  });

  batcher.push({ event_key: 'KEY_1_12345678', event_type: 'PAGE_SUSPENDED' });
  await batcher.flush();
  assert.equal(attempts, 1);

  // Second flush should retry the re-queued event
  await batcher.flush();
  assert.equal(attempts, 2);
  batcher.stop();
});

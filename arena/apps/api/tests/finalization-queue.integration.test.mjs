import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createFinalizationQueue, createFinalizationWorker } from '../dist/services/finalization-queue.js';

test('BullMQ deduplicates pending work, retries a transient failure and resumes after worker restart', { skip: !process.env.ARENA_QUEUE_TEST_URL }, async () => {
  const url = new URL(process.env.ARENA_QUEUE_TEST_URL);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname), 'Dedicated loopback Redis required');
  const producer = createFinalizationQueue(url.toString());
  let consumer;
  const errors=[];
  producer.queue.on('error', error=>errors.push(error));
  let calls=0;
  const id=Date.now();
  const scoring={async submit(student,exam,finalizeOnly){assert.equal(finalizeOnly,true);assert.equal(exam,id);calls++;if(calls===1)throw new Error('temporary database outage');return {student};}};
  async function waitFor(predicate) {
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){if(await predicate())return;await delay(25);}
    assert.fail('Timed out waiting for queue progress');
  }
  try {
    await producer.queue.waitUntilReady();
    await producer.enqueue(id,id);await producer.enqueue(id,id);
    assert.equal((await producer.queue.getJob(`attempt-${id}-${id}`)).data.studentId,id);
    consumer=createFinalizationWorker(url.toString(),scoring,1);
    consumer.worker.on('error',error=>errors.push(error));
    await waitFor(async()=>calls===2 && !await producer.queue.getJob(`attempt-${id}-${id}`));
    await consumer.close();consumer=undefined;
    await producer.enqueue(id+1,id);
    assert.ok(await producer.queue.getJob(`attempt-${id+1}-${id}`));
    consumer=createFinalizationWorker(url.toString(),scoring,1);
    consumer.worker.on('error',error=>errors.push(error));
    await waitFor(async()=>calls===3 && !await producer.queue.getJob(`attempt-${id+1}-${id}`));
    assert.deepEqual(errors,[]);
  } finally {await consumer?.close();await producer.close();}
});

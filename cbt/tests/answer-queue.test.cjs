const { test } = require('node:test');
const assert = require('node:assert/strict');
globalThis.crypto = require('node:crypto').webcrypto;
const Queue = require('../public/assets/js/cbt/answer-queue.js');
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) }; };
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return { promise, resolve, reject }; };
const create = (store, send, key='attempt-one') => new Queue({storage:store,key,attemptId:key,send});

test('offline answers and flags survive refresh and cannot cross attempts', async () => {
 const store = storage();
 const q = create(store, async () => {throw new Error('offline');});
 q.restore([]); q.enqueue(1,'B',true); await assert.rejects(q.flush());
 const refreshed = create(store, async () => ({revision:1}));
 assert.deepEqual(refreshed.restore([]).map(a=>[a.answer,a.is_flagged]), [['B',true]]);
 assert.equal(create(store, async()=>({}), 'attempt-two').state().pending,0);
 await refreshed.flush(); assert.equal(refreshed.state().pending,0);
});
test('rapid edits are ordered and flush waits for every acknowledgement', async () => {
 const gate = defer(), sent = []; const store = storage();
 const q = create(store, async item => {sent.push(item); if(sent.length===1) await gate.promise; return {revision:sent.length};});
 q.restore([]); q.enqueue(1,'A',false); q.enqueue(1,'C',false); q.enqueue(1,'C',true);
 let finished=false; const submitting=q.flush().then(()=>{finished=true;});
 await Promise.resolve(); assert.equal(finished,false); assert.equal(sent.length,1);
 gate.resolve(); await submitting;
 assert.deepEqual(sent.map(i=>[i.answer,i.is_flagged,i.base_revision]),[['A',false,0],['C',false,1],['C',true,2]]);
 assert.equal(q.state().pending,0);
});
test('lost response retries the same mutation and expected revision', async () => {
 const seen=[]; const q=create(storage(),async item=>{seen.push(item); if(seen.length===1) throw new Error('response lost'); return {revision:1};});
 q.restore([]); q.enqueue(4,'D',false); await assert.rejects(q.flush()); await q.flush();
 assert.deepEqual(seen[0],seen[1]); assert.equal(q.state().pending,0);
});
test('refresh acknowledges a committed write whose response was lost', async () => {
 const store=storage(); let sent;
 const q=create(store,async item=>{sent=item;throw new Error('lost');});
 q.restore([]);q.enqueue(4,'A',false);await assert.rejects(q.flush());
 const refreshed=create(store,async()=>{throw new Error('must not send');});
 const restored=refreshed.restore([{question_id:4,answer:'A',is_flagged:0,revision:1,mutation_id:sent.mutation_id}]);
 assert.equal(restored[0].answer,'A');assert.equal(refreshed.state().pending,0);
});
test('conflicting changes remain durable and are not silently rebased on refresh', async () => {
 const store=storage(); const q=create(store,async()=>{throw new Error('offline');});
 q.restore([{question_id:1,answer:'A',revision:2}]);q.enqueue(1,'B',false);await assert.rejects(q.flush());
 let received;
 const refreshed=create(store,async item=>{received=item;throw Object.assign(new Error('conflict'),{status:409});});
 refreshed.restore([{question_id:1,answer:'D',revision:3}]);await assert.rejects(refreshed.flush());
 assert.equal(received.base_revision,2);assert.equal(refreshed.state().blocked,true);assert.equal(refreshed.state().pending,1);
});
test('storage exhaustion rejects new answers without claiming they were saved', () => {
 const store=storage();const q=create(store,async()=>({revision:1}));q.restore([]);
 store.setItem=()=>{throw new Error('quota');};
 assert.throws(()=>q.enqueue(1,'B',false),/belum disimpan/);assert.equal(q.state().pending,0);
});
test('stop waits for in-flight writes and preserves remaining edits', async () => {
 const gate=defer(),store=storage();let count=0;
 const q=create(store,async()=>{count++;await gate.promise;return {revision:1};});q.restore([]);
 q.enqueue(1,'A',false);q.enqueue(2,'B',false);const stopped=q.stop();gate.resolve();await stopped;
 assert.equal(count,1);assert.equal(q.state().pending,1);assert.equal(JSON.parse(store.getItem('attempt-one')).length,1);
});

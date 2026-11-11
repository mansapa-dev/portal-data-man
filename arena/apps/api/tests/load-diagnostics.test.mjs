import assert from 'node:assert/strict';
import test from 'node:test';
import { LoadDiagnostics } from '../dist/lib/load-diagnostics.js';

const logger=()=>{const calls=[];return {calls,warn:(payload,message)=>calls.push({payload,message})};};

test('diagnostik beban nonaktif tidak mengumpulkan sampel',()=>{
  const log=logger();
  const diagnostics=new LoadDiagnostics().start(log,false);
  diagnostics.record('exam_submit',{outcome:'accepted',total_ms:12});
  diagnostics.flush();
  assert.equal(log.calls.length,0);
});

test('flush merangkum outcome dan persentil field numerik',()=>{
  const log=logger();
  const diagnostics=new LoadDiagnostics().start(log,true);
  for(const [outcome,total] of [['accepted',10],['accepted',20],['done',30],['accepted',40]])diagnostics.record('exam_submit',{outcome,total_ms:total});
  diagnostics.flush();
  assert.equal(log.calls.length,1);
  const {payload,message}=log.calls[0];
  assert.equal(message,'load-shape diagnostic window');
  assert.equal(payload.event,'exam_submit');
  assert.equal(payload.samples,4);
  assert.deepEqual(payload.outcomes,{accepted:3,done:1});
  assert.equal(payload.timings_ms.total_ms.p50,20);
  assert.equal(payload.timings_ms.total_ms.p95,40);
  assert.equal(payload.timings_ms.total_ms.max,40);
});

test('sampel penuh memicu flush lebih awal tanpa kehilangan data',()=>{
  const log=logger();
  const diagnostics=new LoadDiagnostics(60_000,2).start(log,true);
  diagnostics.record('waiting_claim',{outcome:'ok',total_ms:5});
  diagnostics.record('waiting_claim',{outcome:'CLAIM_BUSY',total_ms:7});
  assert.equal(log.calls.length,1,'flush otomatis saat batas sampel tercapai');
  assert.equal(log.calls[0].payload.samples,2);
  diagnostics.stop();
  assert.equal(log.calls.length,1,'stop tidak menggandakan flush kosong');
});

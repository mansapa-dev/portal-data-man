import assert from 'node:assert/strict';
import test from 'node:test';
import { WaitingRoomService } from '../dist/services/waiting-room.js';
import { WaitingRoomEvents } from '../dist/services/waiting-room-events.js';

test('stream credentials are signed, owner-bound and time-bound',()=>{
  const service=new WaitingRoomService(null,null,{secret:'waiting-unit-secret'});
  const expires=Math.floor(Date.now()/1000)+600;
  const ticket=service.streamTicket(10,20,expires);
  assert.doesNotThrow(()=>service.verifyStreamTicket(ticket,10,20));
  for(const [exam,student] of [[11,20],[10,21]])assert.throws(()=>service.verifyStreamTicket(ticket,exam,student),{statusCode:403});
  assert.throws(()=>service.verifyStreamTicket(ticket+'x',10,20),{statusCode:403});
  assert.throws(()=>service.verifyStreamTicket(service.streamTicket(10,20,1),10,20),{statusCode:403});
});

test('invalid claim/access tokens fail before touching MySQL or Redis',async()=>{
  const service=new WaitingRoomService(null,null);
  for(const token of ['', 'client-status-ADMITTED', 'z'.repeat(64)]){
    await assert.rejects(service.claim(10,20,token,()=>assert.fail('must not start an exam')),{statusCode:403});
    await assert.rejects(service.authorize(10,20,token),{statusCode:403});
  }
});

test('invalid queue defaults fail at startup',()=>{
  for(const options of [{batch_size:0},{batch_size:1001},{batch_interval_ms:0},{queue_open:2},{heartbeat_timeout_ms:NaN}]){
    assert.throws(()=>new WaitingRoomService(null,null,options),/Konfigurasi waiting room tidak valid/);
  }
});

test('SSE flush reads only the students named by a change notification',async()=>{
  const reads=[];
  const service={
    status:async(examId,studentId)=>{reads.push([examId,studentId]);return {status:'WAITING'};},
    publicView:(view)=>view,
  };
  const hub=new WaitingRoomEvents(service);
  const client=(examId,studentId)=>({examId,studentId,expires:Math.floor(Date.now()/1000)+600,lastPing:Date.now(),reply:{raw:{destroyed:false,writableLength:0,write:()=>true,end:()=>{}}}});
  hub.clients.add(client(7,1));hub.clients.add(client(7,2));hub.clients.add(client(8,3));

  hub.mark(7,[2]);
  await hub.flush();
  assert.deepEqual(reads,[[7,2]],'hanya siswa yang berubah yang dibaca ulang');

  reads.length=0;hub.mark(7,null);
  await hub.flush();
  assert.deepEqual(reads.map(([,student])=>student).sort(),[1,2],'notifikasi semua-klien membaca seluruh siswa exam itu saja');

  reads.length=0;hub.mark(7,[2]);
  await hub.flush();
  assert.deepEqual(reads,[[7,2]],'notifikasi baru membaca siswa yang berubah');

  reads.length=0;
  await hub.flush();
  assert.equal(reads.length,0,'flush tanpa notifikasi baru tidak membaca ulang siapa pun');
});

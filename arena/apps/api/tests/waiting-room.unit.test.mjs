import assert from 'node:assert/strict';
import test from 'node:test';
import { WaitingRoomService } from '../dist/services/waiting-room.js';

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

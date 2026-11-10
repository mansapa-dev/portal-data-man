import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture,enabled } from './helpers/waiting-fixture.mjs';
import { waitingBase,WaitingRoomService } from '../dist/services/waiting-room.js';
import { StudentExamService } from '../dist/services/student-exam.js';
import { WaitingRoomWorker } from '../dist/services/waiting-room-worker.js';

test('FIFO lifecycle, duplicate join, full timer, guarded exam, and durable retry', {skip:!enabled},async()=>{
  const f=await fixture(5);const [a,b,c]=f.students;
  try{
    const first=await f.service.join(f.examId,a);
    const second=await f.service.join(f.examId,b);
    const repeat=await f.service.join(f.examId,a);
    assert.equal(first.status,'WAITING');assert.equal(repeat.queue_number,first.queue_number);assert.equal(repeat.position,1);assert.equal(second.position,2);
    assert.equal(Number((await f.pool.execute('SELECT COUNT(*) n FROM exam_attempts WHERE exam_id=?',[f.examId]))[0][0].n),0,'Waiting must not create attempts/timers');
    await assert.rejects(f.service.authorize(f.examId,a,'a'.repeat(40)),{statusCode:403});
    const [batch,duplicate]=await Promise.all([f.service.release(f.examId,true,0),f.service.release(f.examId,true,0)]);
    assert.equal(batch.released.length+duplicate.released.length,2,'Small queues must release all students exactly once');
    const admitted=await f.service.status(f.examId,a);assert.equal(admitted.status,'ADMITTED');
    await assert.rejects(f.service.authorize(f.examId,b,admitted.admit_token),{statusCode:403});
    const exams=new StudentExamService(f.pool);
    // Waiting must not consume duration even near the admission closing time.
    await f.pool.execute('UPDATE exams SET ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 SECOND) WHERE id=?',[f.examId]);
    const result=await f.service.claim(f.examId,a,admitted.admit_token,receipt=>exams.start(a,f.examId,0,receipt));
    const again=await f.service.claim(f.examId,a,admitted.admit_token,receipt=>exams.start(a,f.examId,0,receipt));
    assert.equal(result.attempt_id,again.attempt_id);assert.equal(String(result.expires_at),String(again.expires_at));
    const [[attempt]]=await f.pool.execute('SELECT started_at,expires_at,TIMESTAMPDIFF(SECOND,started_at,expires_at) duration FROM exam_attempts WHERE exam_id=? AND student_id=?',[f.examId,a]);
    assert.equal(Number(attempt.duration),1800,'Full duration starts on claim, not on queue entry/admission');
    assert.equal((await f.service.authorize(f.examId,a,admitted.admit_token)).status,'IN_EXAM');
    await f.redis.script('FLUSH');
    assert.equal((await f.service.authorize(f.examId,a,admitted.admit_token)).status,'IN_EXAM','cached command must recover from NOSCRIPT');
    assert.equal((await f.service.join(f.examId,a)).status,'IN_EXAM','An active student never requeues');
    await f.pool.execute("UPDATE exam_attempts SET status='COMPLETED' WHERE exam_id=? AND student_id=?",[f.examId,a]);
    await f.service.finish(f.examId,a);
    assert.equal((await f.service.join(f.examId,a)).status,'FINISHED');
    await assert.rejects(f.service.authorize(f.examId,a,admitted.admit_token),{statusCode:403});
    assert.equal((await f.service.authorize(f.examId,a,admitted.admit_token,true)).status,'FINISHED');

    // Expired admissions release slots and require explicit rejoin.
    const base=waitingBase(f.examId);
    await f.redis.hset(`${base}:student:${b}`,'claim_deadline_ms',1);
    await f.redis.zadd(`${base}:admitted`,1,String(b));
    await f.service.sweep(f.examId);
    assert.equal((await f.service.status(f.examId,b)).status,'EXPIRED');
    const oldSequence=(await f.service.status(f.examId,b)).queue_number;
    assert.equal((await f.service.join(f.examId,b)).status,'EXPIRED');
    assert.ok((await f.service.join(f.examId,b,true)).queue_number>oldSequence);
    const waiting=await f.service.join(f.examId,c);
    await f.service.leave(f.examId,c);
    assert.equal((await f.service.status(f.examId,c)).status,'ABANDONED');
    assert.ok((await f.service.join(f.examId,c,true)).queue_number>waiting.queue_number);
  }finally{await f.close();}
});

test('1000 concurrent joins have unique FIFO positions and two workers release at most 300', {skip:!enabled},async()=>{
  const f=await fixture(1000);
  try{
    const starts=await Promise.all(f.students.map(id=>f.service.join(f.examId,id)));
    assert.equal(new Set(starts.map(row=>row.queue_number)).size,1000);
    const sorted=[...starts].sort((a,b)=>a.queue_number-b.queue_number);
    assert.equal(sorted[0].queue_number,1);assert.equal(sorted[999].queue_number,1000);
    for(let i=1;i<sorted.length;i++)assert.ok(sorted[i].joined_at_ms>=sorted[i-1].joined_at_ms);
    const duplicate=await Promise.all(f.students.map(id=>f.service.join(f.examId,id)));
    assert.equal(new Set(duplicate.map(row=>row.queue_number)).size,1000);
    const other=new WaitingRoomService(f.redis,f.pool);
    const released=await Promise.all([f.service.release(f.examId,true,0),other.release(f.examId,true,0)]);
    assert.equal(released.reduce((n,row)=>n+row.released.length,0),300);
    const members=(await f.redis.zrange(`${waitingBase(f.examId)}:waiting`,0,-1)).map(value=>Number(value.split(':')[0]));
    assert.deepEqual(members,Array.from({length:700},(_,i)=>301+i));
    assert.equal((await f.service.status(f.examId,0)).admitted_count,300);
    assert.equal(Number((await f.pool.query('SELECT COUNT(*) n FROM exam_attempts WHERE exam_id=?',[f.examId]))[0][0].n),0);
  }finally{await f.close();}
});

test('heartbeat expiry, worker recovery, and changed batch size preserve remaining FIFO order', {skip:!enabled},async()=>{
  const f=await fixture(10);const [a,b]=f.students;
  try{
    const original=await f.service.join(f.examId,a);await f.service.join(f.examId,b);
    await f.service.heartbeat(f.examId,a);
    assert.equal((await f.service.join(f.examId,a)).queue_number,original.queue_number);
    const base=waitingBase(f.examId);
    await f.redis.hset(`${base}:student:${a}`,'heartbeat_until_ms',1);await f.redis.zadd(`${base}:heartbeats`,1,String(a));
    await f.service.sweep(f.examId);assert.equal((await f.service.status(f.examId,a)).status,'ABANDONED');
    for(const student of f.students.slice(2))await f.service.join(f.examId,student);
    await f.service.updateSettings(f.examId,{queue_open:1,batch_size:3,batch_interval_ms:1000,heartbeat_timeout_ms:90000,claim_timeout_ms:120000});
    const restarted=new WaitingRoomService(f.redis,f.pool);
    const batch=await restarted.release(f.examId,true,0);assert.equal(batch.released.length,3);assert.equal(Number(batch.released[0]),b);
    assert.equal((await restarted.status(f.examId,f.students[4])).position,1);
    await restarted.updateSettings(f.examId,{queue_open:0,batch_size:2,batch_interval_ms:1000,heartbeat_timeout_ms:90000,claim_timeout_ms:120000});
    assert.equal((await restarted.release(f.examId)).released.length,0);
    assert.equal((await restarted.join(f.examId,f.students[4])).position,1,'Refreshing a paused queue preserves the existing position');
    await assert.rejects(restarted.join(f.examId,a,true),{code:'QUEUE_CLOSED'});
  }finally{await f.close();}
});

test('closed, not-open and ended schedules reject new joins without creating attempts', {skip:!enabled},async()=>{
  const f=await fixture(1);const student=f.students[0];
  try{
    await f.pool.execute('UPDATE exams SET starts_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 2 HOUR) WHERE id=?',[f.examId]);
    await assert.rejects(f.service.join(f.examId,student),{code:'QUEUE_NOT_OPEN'});
    await f.pool.execute('UPDATE exams SET starts_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 HOUR),ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR) WHERE id=?',[f.examId]);
    await assert.rejects(f.service.join(f.examId,student),{code:'QUEUE_ENDED'});
    const [[count]]=await f.pool.execute('SELECT COUNT(*) n FROM exam_attempts WHERE exam_id=?',[f.examId]);assert.equal(Number(count.n),0);
  }finally{await f.close();}
});

test('queue settings do not prevent deletion of an unused exam', {skip:!enabled},async()=>{
  const f=await fixture(1);
  try{
    await f.service.updateSettings(f.examId,{queue_open:1,batch_size:300,batch_interval_ms:10000,heartbeat_timeout_ms:90000,claim_timeout_ms:120000});
    await f.pool.execute('DELETE FROM exams WHERE id=?',[f.examId]);
    const [[row]]=await f.pool.execute('SELECT COUNT(*) n FROM exam_waiting_settings WHERE exam_id=?',[f.examId]);
    assert.equal(Number(row.n),0);
    await assert.rejects(f.service.configure(f.examId),{statusCode:404});
    assert.equal(await f.redis.sismember('arena:waiting:active',String(f.examId)),0);
  }finally{await f.close();}
});

test('a crash after MySQL COMMIT is recovered without a duplicate attempt or a new timer', {skip:!enabled},async()=>{
  const f=await fixture(1);const student=f.students[0];
  try{
    await f.service.join(f.examId,student);await f.service.release(f.examId,true,0);
    const admitted=await f.service.status(f.examId,student);
    let failed=false;
    const proxy=new Proxy(f.redis,{get(target,property){
      if(property==='arenaWaitingTransition')return (...args)=>{if(args[6]==='restore' && !failed){failed=true;return Promise.reject(new Error('Simulated process failure after COMMIT'));}return target.arenaWaitingTransition(...args);};
      const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
    }});
    const interrupted=new WaitingRoomService(proxy,f.pool),exams=new StudentExamService(f.pool);
    await assert.rejects(interrupted.claim(f.examId,student,admitted.admit_token,receipt=>exams.start(student,f.examId,0,receipt)),{code:'REDIS_UNAVAILABLE'});
    const [[before]]=await f.pool.execute('SELECT public_id,started_at,expires_at FROM exam_attempts WHERE exam_id=? AND student_id=?',[f.examId,student]);
    assert.ok(before.public_id);
    await f.service.reconcile(f.examId);
    assert.equal((await f.service.status(f.examId,student)).status,'IN_EXAM');
    const retry=await f.service.claim(f.examId,student,admitted.admit_token,receipt=>exams.start(student,f.examId,0,receipt));
    assert.equal(retry.attempt_id,before.public_id);assert.equal(String(retry.expires_at),String(before.expires_at));
    const [[count]]=await f.pool.execute('SELECT COUNT(*) n FROM exam_attempts WHERE exam_id=? AND student_id=?',[f.examId,student]);assert.equal(Number(count.n),1);
  }finally{await f.close();}
});

test('automatic worker ticks share the same batch clock across restarts', {skip:!enabled},async()=>{
  const f=await fixture(8,{batch_size:3,batch_interval_ms:1000});
  try{
    for(const id of f.students)await f.service.join(f.examId,id);
    const base=waitingBase(f.examId);
    await f.redis.hset(`${base}:meta`,'next_batch_at_ms',1);
    const errors=[];const log={warn:value=>errors.push(value)};
    await Promise.all([new WaitingRoomWorker(f.service,log).processExam(f.examId),new WaitingRoomWorker(f.service,log).processExam(f.examId)]);
    assert.deepEqual(errors,[]);
    const state=await f.service.status(f.examId,0);assert.equal(state.admitted_count,3);assert.equal(state.waiting_count,5);assert.equal(state.batch_id,1);
  }finally{await f.close();}
});

test('5000 waiting students can read status and heartbeat entirely from Redis', {skip:!enabled},async(t)=>{
  const f=await fixture(5000);
  try{
    const start=performance.now();
    await Promise.all(f.students.map(id=>f.service.join(f.examId,id)));
    const redisOnly=new WaitingRoomService(f.redis,null);
    const readStart=performance.now();
    const views=await Promise.all(f.students.map(id=>redisOnly.status(f.examId,id)));
    assert.equal(views.length,5000);assert.ok(views.every(view=>view.status==='WAITING' && view.waiting_count===5000));
    assert.equal(new Set(views.map(view=>view.queue_number)).size,5000);
    await Promise.all(f.students.slice(0,1000).map(id=>redisOnly.heartbeat(f.examId,id)));
    t.diagnostic(`Local fixture: 5000 joins ${Math.round(readStart-start)}ms; 5000 cached status + 1000 heartbeat ${Math.round(performance.now()-readStart)}ms. Not a production capacity claim.`);
  }finally{await f.close();}
});

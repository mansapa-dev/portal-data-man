import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { fixture,enabled } from './helpers/waiting-fixture.mjs';
import { WaitingRoomEvents } from '../dist/services/waiting-room-events.js';
import { sharedRateLimitStore } from '../dist/lib/rate-limit-store.js';
import { issueToken,rateLimitKey } from '../dist/lib/auth.js';

if(enabled)process.env.DATABASE_URL=process.env.WAITING_TEST_DATABASE_URL;
after(async()=>{if(enabled){const {pool}=await import('../dist/lib/db.js');await pool?.end();}});
const csrf='c'.repeat(32);
function credentials(id,role='STUDENT'){const token=issueToken({sub:id,role,csrf,exp:Math.floor(Date.now()/1000)+3600});return {token,headers:{authorization:`Bearer ${token}`,'x-csrf-token':csrf}};}
async function application(f){
  const [{studentExamRoutes},{waitingRoomRoutes}]=await Promise.all([import('../dist/routes/student-exams.js'),import('../dist/routes/waiting-room.js')]);
  const app=Fastify();
  app.setErrorHandler((error,_request,reply)=>reply.code(error.statusCode ?? (error.name==='ZodError'?422:500)).send({error:error.message}));
  const hub=new WaitingRoomEvents(f.service);hub.start();
  app.addHook('onClose',async()=>hub.stop());
  await app.register(rateLimit,{max:1200,timeWindow:'1 minute',redis:f.redis,keyGenerator:rateLimitKey,store:sharedRateLimitStore(f.redis)});
  await app.register(studentExamRoutes,{pool:f.pool,waiting:f.service});
  await app.register(waitingRoomRoutes,{service:f.service,events:hub});
  return {app,hub};
}

test('real HTTP join → admit → claim → answer → submit; every exam API rejects an unclaimed student', {skip:!enabled},async()=>{
  const f=await fixture(3);const {app}=await application(f);const [a,b]=f.students;
  try{
    const ca=credentials(a),cb=credentials(b);
    const prefix=`/api/student/exams/${f.examId}`;
    const joined=await app.inject({method:'POST',url:`${prefix}/waiting/join`,headers:ca.headers,payload:{}});
    assert.equal(joined.statusCode,200,joined.body);assert.equal(joined.json().status,'WAITING');
    const again=await app.inject({method:'POST',url:`${prefix}/waiting/join`,headers:ca.headers,payload:{}});
    assert.equal(joined.json().queue_number,again.json().queue_number);
    const forbiddenRoutes=[['POST','/start',{}],['POST','/waiting/claim',{}],['POST','/heartbeat',{}],['POST','/answers/batch',{answers:[]}],['PUT','/answers/1',{}],['POST','/submit',{}],['POST','/violations',{}],['GET','/result'],['GET','/review']];
    for(const [method,url,payload]of forbiddenRoutes){const response=await app.inject({method,url:prefix+url,headers:ca.headers,...(payload?{payload}:{})});assert.ok([403,425].includes(response.statusCode),`${url}: ${response.body}`);}
    assert.equal((await app.inject({method:'GET',url:`${prefix}/waiting/status`})).statusCode,401);
    assert.equal((await app.inject({method:'POST',url:`${prefix}/waiting/join`,headers:{...ca.headers,'x-csrf-token':'wrong'},payload:{}})).statusCode,403);
    await app.inject({method:'POST',url:`${prefix}/waiting/join`,headers:cb.headers,payload:{}});
    const own=await app.inject({method:'GET',url:`${prefix}/waiting/status?student_id=${a}`,headers:cb.headers});
    assert.equal(own.json().position,2,'An arbitrary student_id query never exposes another student');
    await f.service.release(f.examId,true,0);
    const admitted=(await app.inject({method:'GET',url:`${prefix}/waiting/status`,headers:ca.headers})).json();
    assert.equal(admitted.status,'ADMITTED');
    const headers={...ca.headers,'x-exam-token':admitted.admit_token};
    const claimed=await app.inject({method:'POST',url:`${prefix}/waiting/claim`,headers,payload:{}});
    assert.equal(claimed.statusCode,200,claimed.body);
    assert.equal(/correct_answer|option_mapping|pembahasan/.test(claimed.body),false);
    const attempt=claimed.json();
    const stolen=await app.inject({method:'POST',url:`${prefix}/waiting/claim`,headers:{...cb.headers,'x-exam-token':admitted.admit_token},payload:{}});
    assert.equal(stolen.statusCode,403);
    const q=attempt.soal[0];
    const saved=await app.inject({method:'POST',url:`${prefix}/answers/batch`,headers,payload:{attempt_id:attempt.attempt_id,answers:[{question_id:q.id,answer:q.opsi[0].key,is_flagged:false,base_revision:0,mutation_id:'mutation_http_1234567890'}]}});
    assert.equal(saved.statusCode,200,saved.body);
    const submitted=await app.inject({method:'POST',url:`${prefix}/submit`,headers,payload:{}});
    assert.equal(submitted.statusCode,200,submitted.body);
    // Tahap 3: waiting.finish sengaja dilepas setelah response submit, jadi
    // status FINISHED bisa tertinggal beberapa milidetik. Rekonsiler tetap
    // menjamin eventual state; test ini menunggu sebentar, bukan mengubah
    // kontrak penerimaan submit.
    let finished=false;
    for(let i=0;i<100&&!finished;i++){
      finished=(await f.service.status(f.examId,a)).status==='FINISHED';
      if(!finished)await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(finished,true,'deferred waiting.finish must eventually mark the student FINISHED');
    assert.equal((await app.inject({method:'GET',url:`${prefix}/result`,headers})).statusCode,200);
    assert.equal((await app.inject({method:'GET',url:`${prefix}/review`,headers})).statusCode,200);
    assert.equal((await app.inject({method:'POST',url:`${prefix}/heartbeat`,headers,payload:{}})).statusCode,403);
  }finally{await app.close();await f.close();}
});

test('admin controls require admin + CSRF and rate limits apply to waiting endpoints', {skip:!enabled},async()=>{
  const f=await fixture(2);const {app}=await application(f);
  try{
    const student=credentials(f.students[0]),admin=credentials(f.adminId,'ADMIN');
    const url=`/api/admin/waiting-room/${f.examId}`;
    assert.equal((await app.inject({method:'GET',url,headers:student.headers})).statusCode,403);
    const view=await app.inject({method:'GET',url,headers:admin.headers});assert.equal(view.statusCode,200,view.body);
    const settings={queue_open:0,batch_size:2,batch_interval_ms:1000,heartbeat_timeout_ms:90000,claim_timeout_ms:120000};
    assert.equal((await app.inject({method:'PUT',url:`${url}/settings`,headers:{...admin.headers,'x-csrf-token':'wrong'},payload:settings})).statusCode,403);
    assert.equal((await app.inject({method:'PUT',url:`${url}/settings`,headers:admin.headers,payload:{...settings,batch_size:0}})).statusCode,422);
    assert.equal((await app.inject({method:'PUT',url:`${url}/settings`,headers:admin.headers,payload:settings})).statusCode,200);
    const joinUrl=`/api/student/exams/${f.examId}/waiting/join`;
    assert.equal((await app.inject({method:'POST',url:joinUrl,headers:student.headers,payload:{}})).statusCode,409);
    await app.inject({method:'PUT',url:`${url}/settings`,headers:admin.headers,payload:{...settings,queue_open:1}});
    let limited=false;
    for(let i=0;i<14;i++){const reply=await app.inject({method:'POST',url:joinUrl,headers:student.headers,payload:{}});if(reply.statusCode===429){limited=true;break;}}
    assert.equal(limited,true,'Join must be rate limited per authenticated student');
  }finally{await app.close();await f.close();}
});

test('SSE sends only the authenticated student status and publishes a released batch', {skip:!enabled},async()=>{
  const f=await fixture(2);const {app}=await application(f);const controller=new AbortController();
  try{
    const student=f.students[0],auth=credentials(student);
    await f.service.join(f.examId,student);
    const ticket=f.service.streamTicket(f.examId,student,Math.floor(Date.now()/1000)+3600);
    await app.listen({host:'127.0.0.1',port:0});
    const port=app.server.address().port;
    const response=await fetch(`http://127.0.0.1:${port}/api/student/exams/${f.examId}/waiting/events?ticket=${encodeURIComponent(ticket)}`,{headers:{cookie:`arena_student_session=${auth.token}`},signal:controller.signal});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
    const reader=response.body.getReader();let buffer='';const decoder=new TextDecoder();
    async function until(state){const timeout=setTimeout(()=>controller.abort(),8000);try{while(!buffer.includes(`"status":"${state}"`)){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value);}assert.ok(buffer.includes(`"status":"${state}"`),buffer);}finally{clearTimeout(timeout);}}
    await until('WAITING');await f.service.release(f.examId,true,0);await until('ADMITTED');
    assert.equal(buffer.includes('correct_answer'),false);
  }finally{controller.abort();await app.close();await f.close();}
});

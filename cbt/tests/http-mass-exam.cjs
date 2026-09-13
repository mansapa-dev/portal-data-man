// Runs only against the isolated local fixture, spread across four PHP workers.
const assert=require('node:assert/strict');
const { randomBytes }=require('node:crypto');
const http=require('node:http');
function request(url,method,headers,body) {
 return new Promise((resolve,reject)=>{
  const raw=body===undefined?'':JSON.stringify(body);
  const req=http.request(url,{method,headers:{...headers,'Content-Length':Buffer.byteLength(raw)},timeout:120000},response=>{
   let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);
   response.on('end',()=>{try{resolve({status:response.statusCode,headers:response.headers,data:JSON.parse(text)});}catch(error){reject(error);}});
   response.on('error',reject);
  });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('request timeout')));req.end(raw);
 });
}
const samples=[], stages={};
const count=Number(process.argv[2]||1300);
const questionCount=Number(process.env.CBT_TEST_QUESTIONS||40);
const workerCount=Number(process.env.CBT_TEST_WORKERS||4);
assert(Number.isInteger(count)&&count>=1&&count<=2000);
assert(Number.isInteger(workerCount)&&workerCount>=1&&workerCount<=32);
let arrived=0, startedCount=0, release;
const ready=new Promise(resolve=>{release=resolve;});
function arrive(){if(++arrived===count){console.log(JSON.stringify({stage:'start_phase_complete',participants:count,started:startedCount}));release();}}

async function student(number) {
 const base=`http://127.0.0.1:${18471+(number%workerCount)}`;
 let cookie='',csrf='';
 async function api(path,method='GET',body) {
  const started=Date.now();
  const r=await request(base+path,method,{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body);
  if(r.headers['set-cookie'])cookie=r.headers['set-cookie'][0].split(';')[0];
  const payload=r.data;const elapsed=Date.now()-started;samples.push(elapsed);
  const stage=path.replace(/\/\d+/g,'/:id');(stages[stage]??=[]).push(elapsed);
  assert.equal(r.status,200,`${number} ${path}: ${payload.message}`);return payload.data;
 }
 let atBarrier=false;
 try {
 csrf=(await api('/api/auth/me')).csrf_token;
 await api('/api/auth/student/login','POST',{nisn:String(number).padStart(10,'0'),pin:'123456'});
 const started=await api('/api/student/exams/1/start','POST',{});
 assert.equal(started.soal.length,questionCount);assert.equal(JSON.stringify(started).includes('correct_answer'),false);
 startedCount++;atBarrier=true;arrive();await ready;
 const dashboard=await api('/api/student/exams');assert.equal(dashboard[0].can_start,true);
 await api('/api/student/exams/1/heartbeat','POST',{});
 for(const q of started.soal) {
  const write={attempt_id:started.attempt_id,answer:'B',is_flagged:false,base_revision:0,mutation_id:randomBytes(16).toString('hex')};
  await api(`/api/student/exams/1/answers/${q.id}`,'PUT',write);
  await api(`/api/student/exams/1/answers/${q.id}`,'PUT',write);
 }
 const results=await Promise.all([api('/api/student/exams/1/submit','POST',{}),api('/api/student/exams/1/submit','POST',{})]);
 assert.equal(Number(results[0].nilai),100);assert.equal(Number(results[1].nilai),100);
 const restored=await api('/api/student/exams/1/start','POST',{});assert.equal(restored.completed,true);
 const done=await api('/api/student/exams');assert.equal(done[0].can_start,false);
 } finally {if(!atBarrier)arrive();}
}
(async()=>{

 const started=Date.now();
 const results=await Promise.allSettled(Array.from({length:count},(_,i)=>student(i+1)));
 const failures=results.filter(r=>r.status==='rejected');
 samples.sort((a,b)=>a-b);
 const endpointP95=Object.fromEntries(Object.entries(stages).map(([key,values])=>{values.sort((a,b)=>a-b);return [key,values[Math.floor(values.length*.95)]];}));
 console.log(JSON.stringify({students:count,questions:questionCount,workers:workerCount,endpointP95,passed:count-failures.length,failed:failures.length,requests:samples.length,elapsedMs:Date.now()-started,p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1)},null,2));
 failures.forEach(r=>console.error(r.reason.message));process.exitCode=failures.length?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});

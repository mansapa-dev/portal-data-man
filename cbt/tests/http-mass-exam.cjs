// Runs only against the isolated local fixture, spread across four PHP workers.
const assert=require('node:assert/strict');
const { randomBytes }=require('node:crypto');
const http=require('node:http');
function request(url,method,headers,body) {
 return new Promise((resolve,reject)=>{
  const raw=body===undefined?'':JSON.stringify(body);
  const req=http.request(url,{method,headers:{...headers,'Content-Length':Buffer.byteLength(raw)},timeout:60000},response=>{
   let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);
   response.on('end',()=>{try{resolve({status:response.statusCode,headers:response.headers,data:JSON.parse(text)});}catch(error){reject(error);}});
   response.on('error',reject);
  });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('request timeout')));req.end(raw);
 });
}
const samples=[];
async function student(number) {
 const base=`http://127.0.0.1:${18471+(number%4)}`;
 let cookie='',csrf='';
 async function api(path,method='GET',body) {
  const started=Date.now();
  const r=await request(base+path,method,{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body);
  if(r.headers['set-cookie'])cookie=r.headers['set-cookie'][0].split(';')[0];
  const payload=r.data;samples.push(Date.now()-started);
  assert.equal(r.status,200,`${number} ${path}: ${payload.message}`);return payload.data;
 }
 csrf=(await api('/api/auth/me')).csrf_token;
 await api('/api/auth/student/login','POST',{nisn:String(number).padStart(10,'0'),pin:'123456'});
 const started=await api('/api/student/exams/1/start','POST',{});
 assert.equal(started.soal.length,5);assert.equal(JSON.stringify(started).includes('correct_answer'),false);
 await api('/api/student/exams/1/heartbeat','POST',{});
 for(const q of started.soal) {
  const write={attempt_id:started.attempt_id,answer:'B',is_flagged:false,base_revision:0,mutation_id:randomBytes(16).toString('hex')};
  await api(`/api/student/exams/1/answers/${q.id}`,'PUT',write);
  await api(`/api/student/exams/1/answers/${q.id}`,'PUT',write);
 }
 const results=await Promise.all([api('/api/student/exams/1/submit','POST',{}),api('/api/student/exams/1/submit','POST',{})]);
 assert.equal(Number(results[0].nilai),100);assert.equal(Number(results[1].nilai),100);
 const restored=await api('/api/student/exams/1/start','POST',{});assert.equal(restored.completed,true);
}
(async()=>{
 const count=Number(process.argv[2]||50);assert(count>=1&&count<=100);
 const started=Date.now();
 const results=await Promise.allSettled(Array.from({length:count},(_,i)=>student(i+1)));
 const failures=results.filter(r=>r.status==='rejected');
 samples.sort((a,b)=>a-b);
 console.log(JSON.stringify({students:count,passed:count-failures.length,failed:failures.length,requests:samples.length,elapsedMs:Date.now()-started,p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1)},null,2));
 failures.forEach(r=>console.error(r.reason.message));process.exitCode=failures.length?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});

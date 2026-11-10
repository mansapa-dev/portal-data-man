// Local disposable database only. Exercises real HTTP autosave/submit plus
// Redis/BullMQ finalization. It does not measure login, admission or a browser.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

const db = new URL(process.env.DATABASE_URL ?? '');
const redisUrl = new URL(process.env.REDIS_URL ?? '');
if (![db.hostname, redisUrl.hostname].every(h => ['localhost', '127.0.0.1'].includes(h)) || !db.pathname.endsWith('_test')) throw new Error('Requires loopback MySQL *_test database and loopback Redis');
const count = Number(process.env.CAPACITY_STUDENTS ?? 1200);
if (![100, 300, 600, 1200, 1500].includes(count)) throw new Error('Use staged population 100, 300, 600, 1200 or 1500');
process.env.AUTH_TOKEN_SECRET = randomBytes(32).toString('hex');
process.env.DB_POOL_SIZE = '12';
process.env.DB_QUEUE_LIMIT = '240';
const { pool } = await import('../apps/api/dist/lib/db.js');
const { issueToken } = await import('../apps/api/dist/lib/auth.js');
const { ScoringService } = await import('../apps/api/dist/services/scoring.js');
const { createFinalizationQueue, createFinalizationWorker } = await import('../apps/api/dist/services/finalization-queue.js');
const run = randomBytes(6).toString('hex');
const publicId = (n) => `${run}${String(n).padStart(14, '0')}`;
const port = Number(process.env.CAPACITY_PORT ?? 13001);
const processes = Number(process.env.CAPACITY_API_PROCESSES ?? 3);
if (![1, 2, 3].includes(processes)) throw new Error('CAPACITY_API_PROCESSES must be 1..3');
const origins = Array.from({length:processes},(_,i)=>`http://127.0.0.1:${port+i}`);
const servers=[];
let nextOrigin=0;
let producer, consumer, scanner, waitingRedis;
const waitingState=process.env.CAPACITY_WAITING_STATE ?? 'warm';
if(!['warm','cold'].includes(waitingState))throw new Error('CAPACITY_WAITING_STATE must be warm or cold');
const roundDelay = Number(process.env.CAPACITY_ROUND_DELAY_MS ?? 0);
if (!Number.isInteger(roundDelay) || roundDelay < 0 || roundDelay > 60000) throw new Error('CAPACITY_ROUND_DELAY_MS must be 0..60000');
const samples = { autosave: [], submit: [] };
let retries = 0;
async function request(path, token, examToken, body, kind) {
  const started = performance.now();
  const origin = origins[nextOrigin++ % origins.length];
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(origin + path, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { authorization: `Bearer ${token}`, 'x-csrf-token': 'capacity-test-csrf', 'x-exam-token': examToken, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if ([429, 503].includes(response.status)) { retries++; await delay(1000 + Math.random() * 1500); continue; }
    assert.equal(response.status, 200, JSON.stringify(data));
    samples[kind].push(performance.now() - started);
    return data;
  }
  throw new Error('Retry budget exhausted');
}
try {
  const [exam] = await pool.execute("INSERT INTO exams(public_id,name,grade,duration_minutes,starts_at,ends_at,academic_year,semester,status) VALUES(?,'Capacity test','X',60,UTC_TIMESTAMP(3)-INTERVAL 1 HOUR,UTC_TIMESTAMP(3)+INTERVAL 1 HOUR,'2026/2027','ODD','ACTIVE')", [publicId(0)]);
  const examId = exam.insertId;
  const participants = [];
  for (let i = 1; i <= count; i++) {
    const [student] = await pool.execute("INSERT INTO students(portal_student_id,nisn,name_snapshot,grade_snapshot) VALUES(?,?,?,'X')", [`capacity-${run}-${i}`, `${run}${i}`, `Synthetic ${i}`]);
    const [attempt] = await pool.execute("INSERT INTO exam_attempts(public_id,student_id,exam_id,status,started_at,expires_at,question_order,option_mapping) VALUES(?,?,?,'IN_PROGRESS',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)+INTERVAL 1 HOUR,?, '{}')", [publicId(i), student.insertId, examId, JSON.stringify(Array.from({length:10},(_,n)=>n+1))]);
    await pool.query("INSERT INTO attempt_questions(attempt_id,question_id,question_type,question_text,option_a,option_b,correct_answer,option_mapping,points) VALUES ?", [Array.from({length:10},(_,q)=>[attempt.insertId,q+1,'MULTIPLE_CHOICE','Synthetic question','A','B','A','{}',1])]);
    const examToken = randomBytes(24).toString('hex');
    await pool.execute("INSERT INTO exam_waiting_claims(exam_id,student_id,attempt_id,token_hash) VALUES(?,?,?,?)", [examId,student.insertId,attempt.insertId,createHash('sha256').update(examToken).digest('hex')]);
    participants.push({ id: student.insertId, attemptId: attempt.insertId, publicId: publicId(i), examToken, token: issueToken({sub:student.insertId,role:'STUDENT',exp:Math.floor(Date.now()/1000)+3600,csrf:'capacity-test-csrf'}) });
  }
  if(waitingState==='warm') {
    const { waitingRoom }=await import('../apps/api/dist/lib/waiting-room.js');
    const { redis }=await import('../apps/api/dist/lib/redis.js');waitingRedis=redis;
    for(let i=0;i<100&&redis.status!=='ready';i++)await delay(25);
    for(const p of participants)p.examToken=(await waitingRoom.resume(examId,p.id)).admit_token;
  }
  for (let n=0;n<processes;n++) {
    const server=spawn(process.execPath, ['apps/api/dist/server.js'], { cwd: new URL('..', import.meta.url), env: {...process.env, HOST:'127.0.0.1', PORT:String(port+n), ATTEMPT_FINALIZER_ENABLED:'false', WAITING_WORKER_ENABLED:'false', LOG_LEVEL:'silent'}, stdio:['ignore','ignore','inherit'] });
    servers.push(server);
    let ready=false;
    for(let i=0;i<100;i++){try{ready=(await fetch(origins[n]+'/health/ready')).ok;}catch{}if(ready)break;await delay(100);}
    assert.ok(ready,'Every API process must become ready');
  }
  await Promise.all(participants.map(async (p) => {
    await delay(Math.random()*3000);
    for(let revision=0;revision<3;revision++) {
      if(revision && roundDelay)await delay(roundDelay + Math.random()*1000);
      const data=await request(`/api/student/exams/${examId}/answers/batch`,p.token,p.examToken,{attempt_id:p.publicId,answers:Array.from({length:10},(_,q)=>({question_id:q+1,answer:revision===1?'B':'A',is_flagged:false,base_revision:revision,mutation_id:`capacity_${run}_${p.id}_${revision}_${q}`}))},'autosave');
      assert.ok(Object.values(data.revisions).every(v=>v===revision+1));
    }
  }));
  // Deliberately burst half the population at submit; the other half is
  // finalized by BullMQ after expiry, as with disconnected clients.
  const half=Math.floor(count/2);
  await Promise.all(participants.slice(0,half).map(p=>request(`/api/student/exams/${examId}/submit`,p.token,p.examToken,{},'submit')));
  await pool.execute("UPDATE exam_attempts SET expires_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE exam_id=? AND status='IN_PROGRESS'",[examId]);
  producer=createFinalizationQueue(process.env.REDIS_URL);
  consumer=createFinalizationWorker(process.env.REDIS_URL,new ScoringService(pool),4);
  const failures=[];
  producer.queue.on('error',error=>failures.push(error.message));
  consumer.worker.on('error',error=>failures.push(error.message));
  consumer.worker.on('failed',(_job,error)=>failures.push(error.message));
  await producer.queue.waitUntilReady(); await consumer.worker.waitUntilReady();
  const queueStart=performance.now();
  const { ExpiredAttemptFinalizer } = await import('../apps/api/dist/services/expired-attempt-finalizer.js');
  scanner = new ExpiredAttemptFinalizer(pool,new ScoringService(pool),{info(){},warn(){},error(error){failures.push(String(error.err));}},1000,1500,40000,1,4,producer.enqueue);
  scanner.start();
  let resultCount=0;
  while(performance.now()-queueStart<120000) {
    const [[row]]=await pool.query('SELECT COUNT(*) n FROM exam_results r JOIN exam_attempts a ON a.id=r.attempt_id WHERE a.exam_id=?',[examId]);
    resultCount=Number(row.n); if(resultCount===count)break; await delay(100);
  }
  assert.equal(resultCount,count,'Every attempt must have a durable result');
  const [[integrity]]=await pool.query('SELECT COUNT(*) n,MIN(r.score) min_score,MAX(r.score) max_score FROM exam_results r JOIN exam_attempts a ON a.id=r.attempt_id WHERE a.exam_id=?',[examId]);
  assert.equal(Number(integrity.min_score),100); assert.equal(Number(integrity.max_score),100);
  const [[answers]]=await pool.query('SELECT COUNT(*) n,MIN(v.revision) min_revision FROM answer_write_versions v JOIN exam_attempts a ON a.id=v.attempt_id WHERE a.exam_id=?',[examId]);
  assert.equal(Number(answers.n),count*10); assert.equal(Number(answers.min_revision),3);
  assert.deepEqual(failures,[]);
  const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return{requests:sorted.length,p95_ms:Math.round(sorted[Math.ceil(sorted.length*.95)-1]),p99_ms:Math.round(sorted[Math.ceil(sorted.length*.99)-1])};};
  const report={students:count,api_processes:processes,waiting_state:waitingState,round_delay_ms:roundDelay,scope:'Local HTTP autosave/submit and BullMQ expiry; excludes login, admission, browser, CDN and production hardware',autosave:stats(samples.autosave),submit:stats(samples.submit),overload_retries:retries,queue_ms:Math.round(performance.now()-queueStart),results:resultCount,answers_verified:Number(answers.n),minimum_revision:Number(answers.min_revision),scores:100};
  console.log(JSON.stringify(report,null,2));
  if(process.env.CAPACITY_REPORT)await writeFile(process.env.CAPACITY_REPORT,JSON.stringify(report,null,2)+'\n');
} finally {
  await Promise.all(servers.map(async server=>{server.kill('SIGTERM');await Promise.race([new Promise(resolve=>server.once('exit',resolve)),delay(5000)]);if(server.exitCode===null)server.kill('SIGKILL');}));
  await scanner?.stop();await consumer?.close();await producer?.close();waitingRedis?.disconnect();await pool.end();
}

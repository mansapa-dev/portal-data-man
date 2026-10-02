// Explicit isolated MySQL only. Logical concurrency is reported separately from
// active PHP/DB workers: this is NOT a 1,200-connection capacity certification.
const {spawn, spawnSync} = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
assert.equal(process.env.CBT_TEST_ISOLATED, '1');
const root = path.resolve(__dirname, '..'), php = process.env.CBT_TEST_PHP || 'php';
const mode = process.argv[2] || 'test';
const workers = Number(process.env.CBT_TEST_WORKERS || 8);
assert(Number.isInteger(workers) && workers >= 2 && workers <= 32);
function fixture(action) {
  const r = spawnSync(php, ['tests/contention-fixture.php', action], {cwd:root,env:process.env,encoding:'utf8',windowsHide:true});
  assert.equal(r.status,0,r.stderr || r.stdout); return r.stdout.trim();
}
class Worker {
  constructor() {
    this.child=spawn(php,['tests/contention-worker.php'],{cwd:root,env:process.env,windowsHide:true});
    this.profile=[]; this.errors=[];
    readline.createInterface({input:this.child.stderr}).on('line',line=>{
      if(line.startsWith('CBT_PROFILE '))this.profile.push(JSON.parse(line.slice(12))); else this.errors.push(line);
    });
    this.ready=new Promise((resolve,reject)=>{
      this.child.once('error',reject);
      readline.createInterface({input:this.child.stdout}).on('line',line=>{
        try {const value=JSON.parse(line);if(value.ready){this.connection=value.connection;resolve();}else{const pending=this.pending;this.pending=null;pending.resolve(value);}} catch(e){reject(e);this.pending?.reject(e);}
      });
      this.child.once('exit',code=>{const e=new Error(`worker exited ${code}: ${this.errors.join('\n')}`);reject(e);this.pending?.reject(e);});
    });
  }
  async run(job) {await this.ready;assert(!this.pending);return new Promise((resolve,reject)=>{this.pending={resolve,reject};this.child.stdin.write(JSON.stringify(job)+'\n');});}
  async close(){if(this.child.exitCode!==null||this.child.signalCode!==null)return;return new Promise(resolve=>{this.child.once('exit',resolve);this.child.stdin.end();});}
}
const mutation = n => ('mutation-'+n).padEnd(32,'x');
const save = (extra={}) => ({action:'save',student:1,question:1,answer:'A',revision:0,mutation:mutation('one'),...extra});
const percentile=(values,p)=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.ceil(sorted.length*p)-1];};
async function waitForLock(){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){if(Number(fixture('waits'))>0)return;await new Promise(r=>setTimeout(r,20));}
  throw new Error('Expected a real InnoDB lock wait');
}
async function main(){
  fixture('create'); const pool=[];
  try {
    for(let i=0;i<workers;i++)pool.push(new Worker());
    await Promise.all(pool.map(w=>w.ready));
    if(mode==='bench') {
      const results=[];
      for(const count of [100,300,600,1200]) {
        fixture('reset');
        for(const stage of ['insert','duplicate','update','unchanged']) {
          const before=JSON.parse(fixture('stats'));let next=0;const samples=[],service=[],errors=[];
          const profileOffsets=pool.map(w=>w.profile.length);const start=performance.now();
          await Promise.all(pool.map(async worker=>{
            while(next<count){const student=++next;
              const updated=stage==='update'||stage==='unchanged';
              const r=await worker.run(save({student,answer:updated?'B':'A',revision:stage==='unchanged'?2:updated?1:0,mutation:mutation(`${stage==='duplicate'?'insert':stage}-${student}`)}));
              samples.push(performance.now()-start);service.push(r.service_ms);if(!r.ok)errors.push(r);
            }
          }));
          const after=JSON.parse(fixture('stats'));
          const profiles=pool.flatMap((w,i)=>w.profile.slice(profileOffsets[i]));
          const delta=k=>Number(after.status[k])-Number(before.status[k]);
          const commitCount=Number(after.commit.count)-Number(before.commit.count);
          const record={concurrent_requests:count,db_workers:workers,stage,requests:samples.length,error_rate:errors.length/count,
            p50_ms:percentile(samples,.5),p95_ms:percentile(samples,.95),p99_ms:percentile(samples,.99),
            service_p95_ms:percentile(service,.95),db_connections:before.status.Threads_connected,connections_delta:delta('Connections'),
            lock_waits:delta('Innodb_row_lock_waits'),lock_wait_ms:delta('Innodb_row_lock_time'),
            commit_count:commitCount,commit_mean_ms:commitCount?(Number(after.commit.total_ms)-Number(before.commit.total_ms))/commitCount:null,
            transaction_p95_ms:percentile(profiles.filter(p=>p.transaction_total_ms!==undefined).map(p=>p.transaction_total_ms),.95),
            commit_p95_ms:percentile(profiles.filter(p=>p.commit_ms!==undefined).map(p=>p.commit_ms),.95),errors:errors.slice(0,3)};
          results.push(record);console.log(JSON.stringify(record));
        }
      }
      if(process.env.CBT_BENCH_OUTPUT)fs.writeFileSync(process.env.CBT_BENCH_OUTPUT,JSON.stringify(results,null,2)+'\n');
      assert(results.every(r=>r.error_rate===0));
    } else {
      let passed=0;
      const check=(ok,label)=>{assert(ok,label);passed++;console.log('PASS '+label);};
      let r=await pool[0].run(save());check(r.ok&&r.result.revision===1,'answer insert');
      r=await pool[1].run(save());check(r.ok&&r.result.duplicate,'duplicate mutation');
      r=await pool[1].run(save({answer:'B'}));check(!r.ok&&r.status===409,'mutation payload mismatch');
      r=await pool[1].run(save({mutation:mutation('stale')}));check(!r.ok&&r.status===409,'stale revision');
      r=await pool[1].run(save({student:2,attempt:'attempt-1'}));check(!r.ok&&r.status===409,'cross-student attempt rejected');
      r=await pool[1].run(save({question:99}));check(!r.ok&&r.status===404,'question membership checked');
      r=await pool[1].run(save({answer:'E'}));check(!r.ok&&r.status===422,'unavailable choice rejected');
      r=await pool[1].run(save({revision:1,answer:'B',flagged:true,mutation:mutation('update')}));check(r.ok&&r.result.revision===2,'answer update and flagged');
      r=await pool[0].run(save({revision:2,answer:'B',mutation:mutation('unflag')}));check(r.ok&&r.result.revision===3,'unflagged');
      r=await pool[0].run(save({question:2,answer:' hello ',mutation:mutation('short')}));check(r.ok&&r.result.answer==='hello','short answer trimmed');
      r=await pool[0].run(save({question:2,answer:'a'.repeat(501),mutation:mutation('long')}));check(!r.ok&&r.status===422,'short answer length');
      r=await pool[0].run(save({question:3,answer:'b,a,a',mutation:mutation('multi')}));check(r.ok&&r.result.answer==='A,B','multiple response canonicalization');
      fixture('expire');r=await pool[0].run(save({revision:3,mutation:mutation('expired')}));check(!r.ok&&r.status===409,'expired rejects new mutation');
      fixture('terminate');r=await pool[0].run(save({revision:3,mutation:mutation('terminated')}));check(!r.ok&&r.status===409,'terminated rejects new mutation');
      r=await pool[0].run(save({revision:2,answer:'B',mutation:mutation('unflag')}));check(r.ok&&r.result.duplicate,'duplicate after termination remains idempotent');
      for(let i=0;i<12;i++) {
        fixture('reset');
        const pair=await Promise.all([pool[0].run(save({answer:'A',mutation:mutation('a'+i)})),pool[1].run(save({answer:'B',mutation:mutation('b'+i)}))]);
        check(pair.filter(r=>r.ok).length===1&&pair.filter(r=>r.status===409).length===1,'simultaneous autosaves one winner '+i);
        const stored=JSON.parse(fixture('inspect')).find(r=>r.student_id===1);
        check(Number(stored.revision)===1&&stored.answer===pair.find(r=>r.ok).result.answer,'no lost update '+i);
        fixture('reset');
        const race=await Promise.all([pool[0].run(save({answer:'B',mutation:mutation('submit'+i)})),pool[1].run({action:'submit',student:1})]);
        check(race[1].ok&&(race[0].ok||race[0].status===409),'autosave and submit finish '+i);
        const final=JSON.parse(fixture('inspect')).find(r=>r.student_id===1);
        check(final.status==='COMPLETED'&&Math.abs(Number(final.score)-(race[0].ok?33.33:0))<.01,'score includes exactly committed answer '+i);
      }
      fixture('reset');
      const duplicates=await Promise.all([pool[0].run(save()),pool[1].run(save())]);
      check(duplicates.every(r=>r.ok)&&duplicates.filter(r=>r.result.duplicate).length===1,'simultaneous identical mutation writes once');
      const others=await Promise.all([pool[0].run(save({student:2,answer:'B'})),pool[1].run(save({student:3,answer:null,flagged:true}))]);
      check(others.every(r=>r.ok),'independent student writes');
      const rows=JSON.parse(fixture('inspect'));check(rows.find(r=>r.student_id===1).answer==='A'&&rows.find(r=>r.student_id===2).answer==='B'&&rows.find(r=>r.student_id===3).answer===null,'no cross-student answer leak');
      // Force a writer to wait AFTER its preflight read, then change the version
      // before releasing the lock. This catches stale RR snapshots deterministically.
      await pool[0].run({action:'hold',change:true});
      const waiting=pool[1].run(save({revision:1,mutation:mutation('blocked')}));
      try {await waitForLock();} finally {await pool[0].run({action:'release'});}
      r=await waiting;check(!r.ok&&r.status===409,'waiting writer sees revision committed after preflight');
      await pool[0].run({action:'hold',change:true});
      const resume=pool[1].run({action:'resume',student:1});
      try {await waitForLock();} finally {await pool[0].run({action:'release'});}
      r=await resume;check(r.ok&&r.result.jawaban.some(a=>Number(a.question_id)===1&&Number(a.revision)===3),'resume reads answers committed while waiting for attempt lock');
      fixture('reset');await pool[0].run(save());
      await pool[0].run({action:'hold'});
      try {
        r=await Promise.race([pool[1].run(save()),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('duplicate waited for attempt lock')),2000);t.unref();})]);
        check(r.ok&&r.result.duplicate,'duplicate acknowledges committed snapshot while attempt is locked');
      } finally {await pool[0].run({action:'release'});}
      // A real 1205, rollback and retry. The lock remains held across the first
      // timeout; only this isolated test session uses a one-second timeout.
      await pool[0].run({action:'hold'});
      const retryOffset=pool[1].profile.length;
      const retried=pool[1].run(save({revision:1,answer:'B',mutation:mutation('retry'),timeout:true}));
      try {await waitForLock();await new Promise(resolve=>setTimeout(resolve,1100));}
      finally {await pool[0].run({action:'release'});}
      r=await retried;check(r.ok&&r.result.revision===2,'lock timeout retries full transaction without duplicate revision');
      // stderr and stdout are distinct pipes; allow the profile line to arrive.
      await new Promise(resolve=>setTimeout(resolve,20));
      if(Number(process.env.CBT_PROFILE_SAMPLE_RATE)===1)check(pool[1].profile.slice(retryOffset).some(p=>p.retries>=1),'actual 1205 retry observed by profiler');
      console.log(`${passed} assertions passed on separate MySQL connections`);
      console.log(fixture('explain'));
    }
  } finally {await Promise.all(pool.map(w=>w.close()));fixture('cleanup');}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

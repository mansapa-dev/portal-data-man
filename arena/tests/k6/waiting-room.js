import http from 'k6/http';
import {check,sleep} from 'k6';
import {Counter,Trend} from 'k6/metrics';

const fixture=JSON.parse(open(__ENV.TOKENS_FILE || '../../tmp/waiting-load-tokens.json'));
const vus=Number(__ENV.VUS || 5000),base=__ENV.BASE_URL || 'http://127.0.0.1:3001';
if(vus>fixture.users.length)throw new Error('Seed harus menyediakan satu siswa unik per VU');
const statusTime=new Trend('waiting_status_ms',true),claimed=new Counter('waiting_claimed');
export const options={scenarios:{waiting:{executor:'per-vu-iterations',vus,iterations:1,maxDuration:'20m'}},thresholds:{http_req_failed:['rate==0'],checks:['rate==1']},summaryTrendStats:['avg','med','p(95)','p(99)','max']};
export default function(){
  const user=fixture.users[__VU-1],prefix=`${base}/api/student/exams/${fixture.exam_id}`;
  const headers={Authorization:`Bearer ${user.token}`,'X-CSRF-Token':user.csrf,'Content-Type':'application/json'};
  const params=step=>({headers,tags:{step}});
  if(__ENV.MODE!=='simultaneous')sleep(Math.random()*10);
  let response=http.post(`${prefix}/waiting/join`,'{}',params('join'));
  if(!check(response,{'join succeeds':r=>r.status===200}))return;
  let state=response.json(),number=state.queue_number,lastHeartbeat=Date.now();
  const deadline=Date.now()+15*60*1000;
  while(state.status==='WAITING' && Date.now()<deadline){
    sleep(4.5+Math.random());
    if(Date.now()-lastHeartbeat>20000){response=http.post(`${prefix}/waiting/heartbeat`,'{}',params('heartbeat'));lastHeartbeat=Date.now();}
    else response=http.get(`${prefix}/waiting/status`,params('status'));
    statusTime.add(response.timings.duration);
    if(!check(response,{'status succeeds':r=>r.status===200}))return;
    state=response.json();
    if(!check(state,{'queue number stable':value=>value.queue_number===number}))return;
  }
  if(!check(state,{'student admitted':value=>value.status==='ADMITTED'}))return;
  headers['X-Exam-Token']=state.admit_token;
  response=http.post(`${prefix}/waiting/claim`,'{}',params('claim'));
  if(!check(response,{'claim succeeds':r=>r.status===200}))return;
  const attempt=response.json();
  check(attempt,{'full duration after claim':value=>Date.parse(value.expires_at)-Date.parse(value.server_time)>fixture.duration_minutes*60000-5000});
  claimed.add(1);
  if(__ENV.FINISH!=='false'){
    response=http.post(`${prefix}/submit`,'{}',params('finish'));
    check(response,{'finish succeeds':r=>r.status===200});
  }
}

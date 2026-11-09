import { useEffect, useRef, useState } from 'react';
import { api } from './lib/api';
import type { WaitingView } from './lib/waiting-room';
import './styles/exam-admission.css';

type Exam={id:number;name:string;grade:string;session_number:number;status:string};
type Form={queue_open:number;batch_size:number;batch_interval_ms:number;heartbeat_timeout_ms:number;claim_timeout_ms:number};
export function ExamAdmissionControl(){
  const [exams,setExams]=useState<Exam[]>([]),[examId,setExamId]=useState(''),[view,setView]=useState<WaitingView|null>(null),[form,setForm]=useState<Form|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const selected=useRef('');selected.current=examId;
  useEffect(()=>{let active=true;void api<Exam[]>('/api/admin/exams').then(rows=>{if(active)setExams(rows.filter(row=>row.status==='ACTIVE'));}).catch(error=>{if(active)setNotice(error.message);});return()=>{active=false;};},[]);
  useEffect(()=>{
    if(!examId)return;let active=true;
    const load=async()=>{try{const next=await api<WaitingView>(`/api/admin/waiting-room/${examId}`,{timeoutMs:10000});if(active){setView(next);setForm(old=>old ?? {queue_open:next.queue_open ?? (next.queue_state==='CLOSED'?0:1),batch_size:next.batch_size,batch_interval_ms:next.batch_interval_ms,heartbeat_timeout_ms:next.heartbeat_timeout_ms,claim_timeout_ms:next.claim_timeout_ms});}}catch(error){if(active)setNotice(error instanceof Error?error.message:'Status gagal dimuat');}};
    void load();const timer=window.setInterval(()=>{void load();},10000);return()=>{active=false;window.clearInterval(timer);};
  },[examId]);
  async function action(kind:'settings'|'release'){
    if(!view || !form)return;const target=examId;setBusy(true);setNotice('');
    try{const next=await api<WaitingView>(`/api/admin/waiting-room/${target}/${kind}`,{method:kind==='settings'?'PUT':'POST',body:kind==='settings'?form:{expected_batch:view.batch_id},timeoutMs:10000});if(selected.current===target){setView(next);setNotice(kind==='settings'?'Pengaturan disimpan.':`${next.released_count ?? 0} siswa dilepas. Pelepasan berikutnya mengikuti jeda batch.`);}}
    catch(error){setNotice(error instanceof Error?error.message:'Perintah gagal');}finally{setBusy(false);}
  }
  return <section className="exam-admission-control"><h3>Ruang tunggu FIFO</h3><p>Peserta masuk sesuai urutan pertama menekan Mulai Ujian. Maksimal satu batch dilepas pada setiap interval; peserta yang lebih sedikit dari ukuran batch tetap dilepas.</p>
    <label>Ujian / sesi<select disabled={busy} value={examId} onChange={event=>{setExamId(event.target.value);setView(null);setForm(null);setNotice('');}}><option value="">Pilih jadwal</option>{exams.map(exam=><option key={exam.id} value={exam.id}>{exam.name} · {exam.grade} · Sesi {exam.session_number}</option>)}</select></label>
    {view && <><div className="exam-admission-counts"><span>Menunggu: {view.waiting_count}</span><span>Admitted: {view.admitted_count}</span><span>Sedang ujian: {view.in_exam_count}</span><span>Selesai: {view.finished_count}</span></div><p>Status antrean: {view.queue_state} · Batch terakhir: {view.batch_id}</p><button type="button" className="btn btn-primary" disabled={busy || view.queue_state!=='OPEN' || !view.waiting_count} onClick={()=>void action('release')}>Lepas batch berikutnya</button></>}
    {form && <form className="waiting-settings" onSubmit={event=>{event.preventDefault();void action('settings');}}><label><input type="checkbox" checked={form.queue_open===1} onChange={event=>setForm({...form,queue_open:event.target.checked?1:0})}/> Buka antrean</label><label>Ukuran batch<input type="number" min={1} max={1000} required value={form.batch_size} onChange={event=>setForm({...form,batch_size:Number(event.target.value)})}/></label><label>Jeda batch (detik)<input type="number" min={1} max={3600} required value={form.batch_interval_ms/1000} onChange={event=>setForm({...form,batch_interval_ms:Number(event.target.value)*1000})}/></label><label>Timeout heartbeat (detik)<input type="number" min={10} max={600} required value={form.heartbeat_timeout_ms/1000} onChange={event=>setForm({...form,heartbeat_timeout_ms:Number(event.target.value)*1000})}/></label><label>Timeout claim (detik)<input type="number" min={10} max={600} required value={form.claim_timeout_ms/1000} onChange={event=>setForm({...form,claim_timeout_ms:Number(event.target.value)*1000})}/></label><button type="submit" className="btn btn-secondary" disabled={busy}>Simpan pengaturan</button></form>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}

import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, mutationId, setSession } from './lib/api';

type Student = { id: number; nisn: string; nama: string; kelas: string | null; tingkat: string | null };
type Exam = { id: number; nama_ujian: string; durasi: number; status_attempt: string | null; can_start: boolean };
type Question = { id: number; tipe: string; pertanyaan: string; opsi: { key: string; text: string }[]; poin: number };
type Attempt = { attempt_id: string; exam: { id: number; nama_ujian: string }; expires_at: string; soal: Question[]; jawaban: { question_id: number; answer: string | null; is_flagged: boolean; revision: number }[] };
type Staff = { id: number; nama: string; username?: string; role: string };
type ExamDraft = { id?:number; name:string; grade:string; duration_minutes:number; session_number:number; starts_at:string; ends_at:string; academic_year:string; semester:'ODD'|'EVEN'; subject_name:string; status:'DRAFT'|'ACTIVE'|'INACTIVE'|'ARCHIVED'; target_class_ids:string[]; target_student_ids:number[] };
function localDateInput(value:Date){const pad=(n:number)=>String(n).padStart(2,'0');return `${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;}

function App() {
  const [student, setStudent] = useState<Student | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [flags, setFlags] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [nisn, setNisn] = useState('');
  const [pin, setPin] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const timers = useRef(new Map<number, number>());
  const pending = useRef(new Map<number, Promise<void>>());
  const revisionState = useRef<Record<number, number>>({});

  const loadExams = async () => setExams(await api<Exam[]>('/api/student/exams'));
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await api<{ token: string; csrf_token: string; student: Student }>('/api/auth/student/login', { method: 'POST', body: { nisn, pin } });
      setSession(result.token, result.csrf_token); setStudent(result.student); await loadExams();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Login gagal'); }
    finally { setBusy(false); }
  }
  async function staffLogin(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { const result=await api<{token:string;csrf_token:string;staff:Staff}>('/api/auth/staff/login',{method:'POST',body:{username,password}});setSession(result.token,result.csrf_token);setStaff(result.staff); }
    catch(error){setMessage(error instanceof Error?error.message:'Login staf gagal');} finally{setBusy(false);}
  }
  async function start(examId: number) {
    setBusy(true); setMessage('');
    try {
      const result = await api<Attempt>(`/api/student/exams/${examId}/start`, { method: 'POST', body: {} });
      setAttempt(result);
      const savedAnswers: Record<number, string> = {}; const savedRevisions: Record<number, number> = {};
      const savedFlags: Record<number, boolean> = {};
      result.jawaban.forEach((item) => { savedAnswers[item.question_id] = item.answer ?? ''; savedRevisions[item.question_id] = item.revision; savedFlags[item.question_id] = item.is_flagged; });
      revisionState.current = savedRevisions; setAnswers(savedAnswers); setFlags(savedFlags);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Tidak dapat membuka ujian'); }
    finally { setBusy(false); }
  }
  async function save(question: Question, value: string, flagged = flags[question.id] ?? false) {
    if (!attempt) return;
    const previous = pending.current.get(question.id);
    if (previous) await previous;
    const request = (async () => {
    try {
      const result = await api<{ revision: number }>(`/api/student/exams/${attempt.exam.id}/answers/${question.id}`, { method: 'PUT', body: { answer: value || null, is_flagged: flagged, attempt_id: attempt.attempt_id, base_revision: revisionState.current[question.id] ?? 0, mutation_id: mutationId() } });
      revisionState.current = { ...revisionState.current, [question.id]: result.revision };
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Jawaban belum tersimpan'); throw error; }
    })();
    pending.current.set(question.id, request);
    try { await request; } finally { if (pending.current.get(question.id) === request) pending.current.delete(question.id); }
  }
  function change(question: Question, value: string) {
    setAnswers((current) => ({ ...current, [question.id]: value }));
    const old = timers.current.get(question.id); if (old) window.clearTimeout(old);
    timers.current.set(question.id, window.setTimeout(() => { timers.current.delete(question.id); void save(question, value).catch(() => undefined); }, 350));
  }
  function toggleFlag(question: Question) {
    const next = !(flags[question.id] ?? false);
    setFlags((current) => ({ ...current, [question.id]: next }));
    const old = timers.current.get(question.id); if (old) window.clearTimeout(old);
    timers.current.set(question.id, window.setTimeout(() => { timers.current.delete(question.id); void save(question, answers[question.id] ?? '', next).catch(() => undefined); }, 350));
  }
  async function submit() {
    if (!attempt) return;
    setBusy(true);
    try {
      const due = [...timers.current.entries()];
      due.forEach(([, timer]) => window.clearTimeout(timer)); timers.current.clear();
      await Promise.all([...pending.current.values()]);
      for (const [questionId] of due) { const question = attempt.soal.find((item) => item.id === questionId); if (question) await save(question, answers[questionId] ?? '', flags[questionId] ?? false); }
      const result = await api<{ nilai: number; benar: number; jumlah_soal: number }>(`/api/student/exams/${attempt.exam.id}/submit`, { method: 'POST', body: {} });
      setMessage(`Ujian selesai. Nilai ${result.nilai} (${result.benar}/${result.jumlah_soal}).`); setAttempt(null); await loadExams();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Submit gagal'); }
    finally { setBusy(false); }
  }
  async function logout() { try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* local logout still clears the in-memory token */ } setSession(null, null); setStudent(null); setStaff(null); setAttempt(null); setExams([]); }
  useEffect(() => { const params=new URLSearchParams(window.location.hash.slice(1));const token=params.get('token'),csrf=params.get('csrf');if(token&&csrf){setSession(token,csrf);void api<{staff:Staff}>('/api/auth/me').then((data)=>setStaff(data.staff)).catch((error)=>setMessage(error instanceof Error?error.message:'SSO gagal'));history.replaceState(null,'',window.location.pathname);} }, []);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  useEffect(() => {
    if (!attempt) return;
    let timer = 0;
    const heartbeat = () => {
      void api(`/api/student/exams/${attempt.exam.id}/heartbeat`, { method: 'POST', body: {} }).catch((error) => setMessage(error instanceof Error ? error.message : 'Koneksi ujian terputus'));
      timer = window.setTimeout(heartbeat, 45_000 + Math.floor(Math.random() * 15_000));
    };
    timer = window.setTimeout(heartbeat, 45_000 + Math.floor(Math.random() * 15_000));
    return () => window.clearTimeout(timer);
  }, [attempt]);

  const page: React.CSSProperties = { maxWidth: 920, margin: '7vh auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#102a43' };
  const card: React.CSSProperties = { border: '1px solid #d9e2ec', borderRadius: 14, padding: 20, margin: '12px 0', background: '#fff' };
  return <main style={page}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><small style={{ color: '#167d76', fontWeight: 700, letterSpacing: '.1em' }}>ARENA</small><h1 style={{ marginTop: 4 }}>Platform Ujian</h1></div>{(student||staff) && <button onClick={() => void logout()}>Keluar</button>}</header>
    {message && <p role="status" style={{ ...card, background: '#fff8e1' }}>{message}</p>}
    {staff ? <StaffPanel staff={staff} /> : student ? attempt ? <section><h2>{attempt.exam.nama_ujian}</h2><p>Waktu berakhir: {new Date(attempt.expires_at).toLocaleString('id-ID')}</p>{attempt.soal.map((question, index) => <article key={question.id} style={card}><h3>Soal {index + 1}</h3><button type="button" aria-pressed={flags[question.id] ?? false} onClick={() => toggleFlag(question)}>{flags[question.id] ? 'Hapus tanda ragu' : 'Tandai ragu'}</button><div dangerouslySetInnerHTML={{ __html: question.pertanyaan }} />{question.tipe === 'SHORT_ANSWER' ? <input value={answers[question.id] ?? ''} onChange={(event) => change(question, event.target.value)} /> : question.opsi.map((option) => <label key={option.key} style={{ display: 'block', padding: 8 }}><input type={question.tipe === 'MULTIPLE_RESPONSE' ? 'checkbox' : 'radio'} name={`question-${question.id}`} checked={(answers[question.id] ?? '').split(',').includes(option.key)} onChange={(event) => { const current = new Set((answers[question.id] ?? '').split(',').filter(Boolean)); if (question.tipe === 'MULTIPLE_RESPONSE') event.target.checked ? current.add(option.key) : current.delete(option.key); else { current.clear(); current.add(option.key); } change(question, [...current].sort().join(',')); }} /> <b>{option.key}.</b> <span dangerouslySetInnerHTML={{ __html: option.text }} /></label>)}</article>)}<button disabled={busy} onClick={() => void submit()}>{busy ? 'Menyimpan…' : 'Selesaikan ujian'}</button><StudentSupport examId={attempt.exam.id} /></section> : <section><h2>Halo, {student.nama}</h2><p>{student.kelas ?? ''} · {student.tingkat ?? ''}</p><h3>Ujian tersedia</h3>{exams.map((exam) => <article key={exam.id} style={card}><h3>{exam.nama_ujian}</h3><p>Durasi {exam.durasi} menit</p><button disabled={busy || !exam.can_start} onClick={() => void start(exam.id)}>{exam.status_attempt === 'IN_PROGRESS' ? 'Lanjutkan' : 'Mulai ujian'}</button></article>)}<StudentSupport /></section> : <><form onSubmit={(event) => void login(event)} style={card}><h2>Masuk siswa</h2><label>NISN<input required value={nisn} onChange={(event) => setNisn(event.target.value)} style={{ display: 'block', width: '100%', padding: 12, margin: '6px 0 14px' }} /></label><label>PIN<input required type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} style={{ display: 'block', width: '100%', padding: 12, margin: '6px 0 14px' }} /></label><button disabled={busy}>{busy ? 'Memproses…' : 'Masuk siswa'}</button></form><form onSubmit={(event)=>void staffLogin(event)} style={card}><h2>Masuk staf/admin</h2><label>Username<input required value={username} onChange={(event)=>setUsername(event.target.value)} /></label><label>Password<input required type="password" value={password} onChange={(event)=>setPassword(event.target.value)} /></label><button disabled={busy}>Masuk staf</button> <a href="/auth/sso/start">Masuk dengan Portal Data</a></form></>}
  </main>;
}

function StudentSupport({ examId }: { examId?: number }) {
  const [category,setCategory]=useState('TECHNICAL');
  const [message,setMessage]=useState('');
  const [tickets,setTickets]=useState<Array<Record<string,unknown>>>([]);
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const card:React.CSSProperties={border:'1px solid #d9e2ec',borderRadius:12,padding:18,margin:'12px 0',background:'#fff'};
  async function refresh(){try{setTickets(await api<Array<Record<string,unknown>>>('/api/student/support-tickets'));}catch(error){setNotice(error instanceof Error?error.message:'Tiket gagal dimuat');}}
  useEffect(()=>{void refresh();},[]);
  async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setNotice('');try{await api('/api/student/support-tickets/request',{method:'POST',body:{category,message,exam_id:examId??null}});setMessage('');setNotice('Permintaan bantuan terkirim');await refresh();}catch(error){setNotice(error instanceof Error?error.message:'Tiket gagal dibuat');}finally{setBusy(false);}}
  return <section style={card}><h3>Bantuan</h3><form onSubmit={(event)=>void submit(event)}><label>Topik <select value={category} onChange={(event)=>setCategory(event.target.value)}>{[['ACCOUNT_ACCESS','Akun'],['EXAM_LOCKED','Ujian terkunci'],['PIN','PIN'],['CONNECTION','Koneksi'],['TECHNICAL','Gangguan teknis'],['OTHER','Lainnya']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><textarea required minLength={5} maxLength={1000} rows={3} value={message} onChange={(event)=>setMessage(event.target.value)} placeholder="Jelaskan kendala yang dialami" style={{display:'block',width:'100%',padding:8,boxSizing:'border-box',margin:'8px 0'}}/><button disabled={busy}>{busy?'Mengirim…':'Kirim tiket'}</button></form>{notice&&<p role="status">{notice}</p>}{tickets.map((ticket)=><article key={String(ticket.id)} style={{borderTop:'1px solid #e5eaf0',marginTop:12,paddingTop:8}}><b>{String(ticket.category)} · {String(ticket.status)}</b><p>{String(ticket.message)}</p><small>{String(ticket.updatedAt??'')}</small></article>)}</section>;
}


function StaffPanel({ staff }: { staff: Staff }) {
  const admin = staff.role === 'ADMIN';
  const [view, setView] = useState(admin ? 'dashboard' : 'dashboard');
  const [data, setData] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [syncType, setSyncType] = useState('STUDENTS');
  const [importRows, setImportRows] = useState('[]');
  const [examId, setExamId] = useState('');
  const [reason, setReason] = useState('');
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);
  const [messageThread, setMessageThread] = useState<Record<string, unknown> | null>(null);
  const [messageDraft, setMessageDraft] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [reportExamId, setReportExamId] = useState('');
  const [reportData, setReportData] = useState<Record<string, unknown> | null>(null);
  const [classChoices,setClassChoices]=useState<Array<Record<string,unknown>>>([]);
  const [examFormOpen,setExamFormOpen]=useState(false);
  const [studentTargetsText,setStudentTargetsText]=useState('');
  const [examDraft,setExamDraft]=useState<ExamDraft>({name:'',grade:'',duration_minutes:60,session_number:1,starts_at:'',ends_at:'',academic_year:'',semester:'ODD',subject_name:'',status:'DRAFT',target_class_ids:[],target_student_ids:[]});
  const routes: Record<string,string> = admin ? {
    dashboard:'/api/admin/dashboard', students:'/api/admin/students', exams:'/api/admin/exams', results:'/api/admin/results', reports:'/api/admin/exams', violations:'/api/admin/violations', tickets:'/api/staff/support-tickets', messages:'/api/staff/admin-communications', sync:'/api/admin/portal-data/sync/status', questions:'/api/admin/questions', sessions:'/api/admin/live-sessions', assignments:'/api/admin/teacher-assignments'
  } : { dashboard:'/api/teacher/dashboard', sessions:'/api/teacher/live-sessions', violations:'/api/staff/violations', tickets:'/api/staff/support-tickets', messages:'/api/staff/admin-communications' };
  const load = async (key=view) => { setBusy(true);setNotice('');try{setData(await api(routes[key]));}catch(error){setNotice(error instanceof Error?error.message:'Data gagal dimuat');}finally{setBusy(false);} };
  useEffect(()=>{void load(view);},[view]);
  useEffect(()=>{if(view==='exams'&&admin)void api<Array<Record<string,unknown>>>('/api/admin/portal-classes').then(setClassChoices).catch((error)=>setNotice(error instanceof Error?error.message:'Daftar kelas gagal dimuat'));},[view,admin]);
  const card:React.CSSProperties={border:'1px solid #d9e2ec',borderRadius:12,padding:18,margin:'12px 0',background:'#fff'};
  async function sync(){setBusy(true);try{const result=await api(`/api/admin/portal-data/sync/${syncType}`,{method:'POST',body:{}});setData(result);setNotice('Sinkronisasi selesai');}catch(error){setNotice(error instanceof Error?error.message:'Sinkronisasi gagal');}finally{setBusy(false);}}
  async function importQuestions(){setBusy(true);try{const rows=JSON.parse(importRows);setData(await api('/api/admin/questions/import',{method:'POST',body:{rows}}));setNotice('Import selesai');}catch(error){setNotice(error instanceof Error?error.message:'JSON import tidak valid');}finally{setBusy(false);}}
  async function resetSelected(){if(!selectedStudents.length){setNotice('Pilih siswa dahulu dari daftar siswa.');return;}setBusy(true);try{setData(await api('/api/admin/students/reset-batch',{method:'POST',body:{student_ids:selectedStudents,exam_id:Number(examId),reason}}));setNotice('Reset batch diproses');}catch(error){setNotice(error instanceof Error?error.message:'Reset gagal');}finally{setBusy(false);}}
  async function ticketAction(ticket:Record<string,unknown>,status:string){setBusy(true);try{setData(await api(`/api/staff/support-tickets/${ticket.id}/status`,{method:'POST',body:{status,note:''}}));await load('tickets');}catch(error){setNotice(error instanceof Error?error.message:'Update tiket gagal');}finally{setBusy(false);}}
  async function openThread(id:string){setBusy(true);setNotice('');try{setMessageThread(await api(`/api/staff/admin-communications/${id}`) as Record<string,unknown>);}catch(error){setNotice(error instanceof Error?error.message:'Percakapan gagal dimuat');}finally{setBusy(false);}}
  async function createThread(event:React.FormEvent){event.preventDefault();setBusy(true);setNotice('');try{await api('/api/staff/admin-communications',{method:'POST',body:{category:'OTHER',subject:newSubject,message:newMessage}});setNewSubject('');setNewMessage('');setNotice('Pesan terkirim');await load('messages');}catch(error){setNotice(error instanceof Error?error.message:'Pesan gagal dikirim');}finally{setBusy(false);}}
  async function replyThread(event:React.FormEvent){event.preventDefault();if(!messageThread)return;const thread=messageThread.thread as Record<string,unknown>;setBusy(true);setNotice('');try{await api(`/api/staff/admin-communications/${thread.public_id}/messages`,{method:'POST',body:{message:messageDraft}});setMessageDraft('');await openThread(String(thread.public_id));await load('messages');}catch(error){setNotice(error instanceof Error?error.message:'Balasan gagal dikirim');}finally{setBusy(false);}}
  async function resolveThread(id:string){setBusy(true);try{await api(`/api/staff/admin-communications/${id}/status`,{method:'POST',body:{status:'RESOLVED'}});setNotice('Percakapan diselesaikan');setMessageThread(null);await load('messages');}catch(error){setNotice(error instanceof Error?error.message:'Percakapan gagal diselesaikan');}finally{setBusy(false);}}
  async function loadReport(id:string){setReportExamId(id);setBusy(true);setNotice('');try{setReportData(await api(`/api/admin/exams/${id}/report`) as Record<string,unknown>);}catch(error){setNotice(error instanceof Error?error.message:'Laporan gagal dimuat');}finally{setBusy(false);}}
  function newExam(){const start=new Date();start.setMinutes(0,0,0);const end=new Date(start.getTime()+60*60_000);setExamDraft({name:'',grade:'',duration_minutes:60,session_number:1,starts_at:localDateInput(start),ends_at:localDateInput(end),academic_year:'',semester:'ODD',subject_name:'',status:'DRAFT',target_class_ids:[],target_student_ids:[]});setStudentTargetsText('');setExamFormOpen(true);}
  async function editExam(id:number){setBusy(true);try{const row=await api<Record<string,unknown>>(`/api/admin/exams/${id}`);setExamDraft({id:Number(row.id),name:String(row.name),grade:String(row.grade),duration_minutes:Number(row.duration_minutes),session_number:Number(row.session_number),starts_at:localDateInput(new Date(String(row.starts_at))),ends_at:localDateInput(new Date(String(row.ends_at))),academic_year:String(row.academic_year),semester:row.semester as 'ODD'|'EVEN',subject_name:String(row.subject_name??''),status:row.status as ExamDraft['status'],target_class_ids:row.target_class_ids as string[],target_student_ids:row.target_student_ids as number[]});setStudentTargetsText((row.target_student_ids as number[]).join(', '));setExamFormOpen(true);}catch(error){setNotice(error instanceof Error?error.message:'Data ujian gagal dimuat');}finally{setBusy(false);}}
  async function saveExam(event:React.FormEvent){event.preventDefault();setBusy(true);setNotice('');try{const targets=studentTargetsText.split(/[\s,;]+/).filter(Boolean).map(Number);if(targets.some((value)=>!Number.isSafeInteger(value)||value<1))throw new Error('Daftar ID siswa harus berupa angka positif');await api('/api/admin/exams',{method:'POST',body:{...examDraft,starts_at:new Date(examDraft.starts_at).toISOString(),ends_at:new Date(examDraft.ends_at).toISOString(),subject_name:examDraft.subject_name||null,target_student_ids:targets}});setExamFormOpen(false);setNotice(examDraft.id?'Perubahan ujian tersimpan':'Ujian berhasil dibuat');await load('exams');}catch(error){setNotice(error instanceof Error?error.message:'Ujian gagal disimpan');}finally{setBusy(false);}}
  const threads=Array.isArray(data)?data as Array<Record<string,unknown>>:[];
  const threadDetail=messageThread?.thread as Record<string,unknown>|undefined;
  const threadMessages=Array.isArray(messageThread?.messages)?messageThread.messages as Array<Record<string,unknown>>:[];
  return <section style={card}><h2>{staff.nama} · {staff.role}</h2><nav style={{display:'flex',gap:8,flexWrap:'wrap'}}>{Object.keys(routes).map((key)=><button key={key} onClick={()=>setView(key)}>{key}</button>)}</nav>{notice&&<p role="status">{notice}</p>}{busy&&<p>Memproses…</p>}
    {view==='sync'&&<div style={{...card,display:'flex',gap:8}}><select value={syncType} onChange={(e)=>setSyncType(e.target.value)}>{['STUDENTS','TEACHERS','EMPLOYEES','CLASSES','ACADEMIC_YEARS','SEMESTERS'].map((x)=><option key={x}>{x}</option>)}</select><button disabled={busy} onClick={()=>void sync()}>Sinkronkan Portal Data</button></div>}
    {view==='exams'&&admin&&<div style={card}><button disabled={busy} onClick={newExam}>Buat ujian</button>{examFormOpen&&<form onSubmit={(event)=>void saveExam(event)} style={{...card,background:'#f7fafc'}}><h3>{examDraft.id?'Ubah ujian':'Ujian baru'}</h3><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10}}><label>Nama ujian<input required minLength={3} maxLength={191} value={examDraft.name} onChange={(event)=>setExamDraft({...examDraft,name:event.target.value})} style={{display:'block',width:'100%'}}/></label><label>Tingkat<select required value={examDraft.grade} onChange={(event)=>setExamDraft({...examDraft,grade:event.target.value})}><option value="">Pilih tingkat</option>{['VII','VIII','IX','X','XI','XII'].map((grade)=><option key={grade}>{grade}</option>)}</select></label><label>Mata pelajaran<input maxLength={100} value={examDraft.subject_name} onChange={(event)=>setExamDraft({...examDraft,subject_name:event.target.value})}/></label><label>Durasi (menit)<input required type="number" min={1} max={600} value={examDraft.duration_minutes} onChange={(event)=>setExamDraft({...examDraft,duration_minutes:Number(event.target.value)})}/></label><label>Sesi<input required type="number" min={1} max={20} value={examDraft.session_number} onChange={(event)=>setExamDraft({...examDraft,session_number:Number(event.target.value)})}/></label><label>Tahun ajaran<input required maxLength={30} placeholder="2026/2027" value={examDraft.academic_year} onChange={(event)=>setExamDraft({...examDraft,academic_year:event.target.value})}/></label><label>Semester<select value={examDraft.semester} onChange={(event)=>setExamDraft({...examDraft,semester:event.target.value as 'ODD'|'EVEN'})}><option value="ODD">Ganjil</option><option value="EVEN">Genap</option></select></label><label>Status<select value={examDraft.status} onChange={(event)=>setExamDraft({...examDraft,status:event.target.value as ExamDraft['status']})}>{[['DRAFT','Draft'],['ACTIVE','Aktif'],['INACTIVE','Nonaktif'],['ARCHIVED','Arsip']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Mulai<input required type="datetime-local" value={examDraft.starts_at} onChange={(event)=>setExamDraft({...examDraft,starts_at:event.target.value})}/></label><label>Selesai<input required type="datetime-local" value={examDraft.ends_at} onChange={(event)=>setExamDraft({...examDraft,ends_at:event.target.value})}/></label></div><fieldset style={{marginTop:12}}><legend>Target kelas (kosong berarti semua kelas pada tingkat ini)</legend><div style={{maxHeight:180,overflow:'auto',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))'}}>{classChoices.filter((item)=>!item.grade||String(item.grade).toUpperCase()===examDraft.grade).map((item)=><label key={String(item.portal_class_id)}><input type="checkbox" checked={examDraft.target_class_ids.includes(String(item.portal_class_id))} onChange={(event)=>setExamDraft({...examDraft,target_class_ids:event.target.checked?[...new Set([...examDraft.target_class_ids,String(item.portal_class_id)])]:examDraft.target_class_ids.filter((id)=>id!==String(item.portal_class_id))})}/>{String(item.name)} ({String(item.code)})</label>)}</div></fieldset><label>Target siswa khusus (ID Arena, pisahkan koma atau baris baru)<textarea rows={2} value={studentTargetsText} onChange={(event)=>setStudentTargetsText(event.target.value)} style={{display:'block',width:'100%',boxSizing:'border-box'}}/></label><div style={{marginTop:12}}><button disabled={busy}>Simpan ujian</button> <button type="button" disabled={busy} onClick={()=>setExamFormOpen(false)}>Batal</button></div></form>}{Array.isArray(data)&&<div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left',marginTop:12}}><thead><tr><th>Ujian</th><th>Tingkat</th><th>Jadwal</th><th>Status</th><th>Soal</th><th>Percobaan</th><th></th></tr></thead><tbody>{(data as Array<Record<string,unknown>>).map((row)=><tr key={String(row.id)}><td>{String(row.name)}<br/><small>ID {String(row.id)} · {String(row.subject_name??'')}</small></td><td>{String(row.grade)}</td><td>{new Date(String(row.starts_at)).toLocaleString('id-ID')}</td><td>{String(row.status)}</td><td>{String(row.question_count)}</td><td>{String(row.attempt_count)}</td><td><button disabled={busy} onClick={()=>void editExam(Number(row.id))}>Ubah</button></td></tr>)}</tbody></table></div>}</div>}
    {view==='questions'&&admin&&<div style={card}><p>Tempel array JSON baris soal; format CBT Indonesia maupun Arena didukung.</p><textarea value={importRows} onChange={(e)=>setImportRows(e.target.value)} rows={8} style={{width:'100%'}}/><button disabled={busy} onClick={()=>void importQuestions()}>Impor soal</button></div>}
    {view==='students'&&admin&&<div style={card}><p>Reset batch hanya membuka attempt yang dihentikan setelah tiga pelanggaran. Pilih siswa di tabel.</p><label>ID ujian <input value={examId} onChange={(e)=>setExamId(e.target.value)}/></label> <label>Alasan <input value={reason} onChange={(e)=>setReason(e.target.value)}/></label><button disabled={busy} onClick={()=>void resetSelected()}>Reset {selectedStudents.length} siswa terpilih</button>{typeof data==='object'&&data!==null&&Array.isArray((data as {items?:unknown[]}).items)&&<><button onClick={()=>setSelectedStudents(((data as {items:Array<{id:number}>}).items).map((x)=>x.id))}>Pilih semua halaman</button><table style={{width:'100%',marginTop:12}}><thead><tr><th>Pilih</th><th>NISN</th><th>Nama</th><th>Kelas</th><th>Attempt</th></tr></thead><tbody>{((data as {items:Array<Record<string,unknown>>}).items).map((row)=><tr key={String(row.id)}><td><input type="checkbox" checked={selectedStudents.includes(Number(row.id))} onChange={(event)=>setSelectedStudents((current)=>event.target.checked?[...new Set([...current,Number(row.id)])]:current.filter((id)=>id!==Number(row.id)))}/></td><td>{String(row.nisn)}</td><td>{String(row.name_snapshot)}</td><td>{String(row.class_snapshot??'')}</td><td>{String(row.attempt_status??'')}</td></tr>)}</tbody></table></>}</div>}
    {view==='tickets'&&Array.isArray(data)&&<div>{(data as Array<Record<string,unknown>>).map((ticket)=><article style={card} key={String(ticket.id)}><b>{String(ticket.studentName)} · {String(ticket.category)} · {String(ticket.status)}</b><p>{String(ticket.message)}</p><small>{String(ticket.examName??'')}</small><div><button disabled={busy||ticket.status!=='OPEN'} onClick={()=>void ticketAction(ticket,'IN_PROGRESS')}>Ambil</button><button disabled={busy||ticket.status!=='IN_PROGRESS'} onClick={()=>void ticketAction(ticket,'RESOLVED')}>Selesaikan</button></div></article>)}</div>}
    {view==='reports'&&<div style={card}><label>Ujian <select value={reportExamId} onChange={(event)=>void loadReport(event.target.value)}><option value="">Pilih ujian</option>{Array.isArray(data)&&(data as Array<Record<string,unknown>>).map((exam)=><option key={String(exam.id)} value={String(exam.id)}>{String(exam.name)}</option>)}</select></label>{reportData&&<><h3>Ringkasan hasil</h3><dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:12}}>{Object.entries((reportData.summary??{}) as Record<string,unknown>).map(([key,value])=><div key={key}><dt>{key.replaceAll('_',' ')}</dt><dd>{value===null?'—':String(value)}</dd></div>)}</dl><h3>Distribusi nilai</h3><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>Rentang mulai</th><th>Jumlah peserta</th></tr></thead><tbody>{(Array.isArray(reportData.distribution)?reportData.distribution as Array<Record<string,unknown>>:[]).map((row,index)=><tr key={index}><td>{String(row.score_band)}</td><td>{String(row.students)}</td></tr>)}</tbody></table></>}</div>}
    {view==='results'&&typeof data==='object'&&data!==null&&Array.isArray((data as {items?:unknown[]}).items)&&<div style={{...card,overflowX:'auto'}}><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>Siswa</th><th>Kelas</th><th>Ujian</th><th>Skor</th><th>Benar</th><th>Salah</th><th>Kosong</th><th>Selesai</th></tr></thead><tbody>{((data as {items:Array<Record<string,unknown>>}).items).map((row)=><tr key={String(row.id)}><td>{String(row.name_snapshot)} · {String(row.nisn)}</td><td>{String(row.class_snapshot??'')}</td><td>{String(row.exam_name)}</td><td>{String(row.score)}</td><td>{String(row.correct_count)}</td><td>{String(row.wrong_count)}</td><td>{String(row.blank_count)}</td><td>{String(row.created_at)}</td></tr>)}</tbody></table></div>}
    {view==='messages'&&<div style={{display:'grid',gridTemplateColumns:'minmax(220px,1fr) minmax(280px,2fr)',gap:12,alignItems:'start'}}>
      <div><form style={card} onSubmit={(event)=>void createThread(event)}><h3>{admin?'Pesan ke staf':'Pesan ke admin'}</h3><input required minLength={4} maxLength={180} placeholder="Subjek" value={newSubject} onChange={(event)=>setNewSubject(event.target.value)} style={{width:'100%',padding:8,boxSizing:'border-box'}}/><textarea required minLength={2} maxLength={2000} placeholder="Tulis pesan" value={newMessage} onChange={(event)=>setNewMessage(event.target.value)} rows={4} style={{width:'100%',padding:8,boxSizing:'border-box',marginTop:8}}/><button disabled={busy}>Kirim pesan</button></form>{threads.map((thread)=><button key={String(thread.id)} onClick={()=>void openThread(String(thread.id))} style={{...card,width:'100%',textAlign:'left',cursor:'pointer'}}><b>{String(thread.subject)}</b><div>{String(thread.creator_name)} · {String(thread.status)}</div><small>{String(thread.last_message??'')}</small></button>)}</div>
      <div style={card}>{threadDetail?<><h3>{String(threadDetail.subject)}</h3><p>{String(threadDetail.category)} · {String(threadDetail.status)}</p><div style={{maxHeight:360,overflow:'auto'}}>{threadMessages.map((item)=><article key={String(item.id)} style={{padding:'8px 0',borderBottom:'1px solid #e5eaf0'}}><b>{String(item.sender_name)} · {String(item.sender_role)}</b><p style={{whiteSpace:'pre-wrap'}}>{String(item.message)}</p><small>{String(item.created_at)}</small></article>)}</div>{threadDetail.status!=='RESOLVED'&&<form onSubmit={(event)=>void replyThread(event)}><textarea required minLength={2} maxLength={2000} rows={3} placeholder="Tulis balasan" value={messageDraft} onChange={(event)=>setMessageDraft(event.target.value)} style={{width:'100%',padding:8,boxSizing:'border-box',marginTop:10}}/><button disabled={busy}>Balas</button>{admin&&<button type="button" disabled={busy} onClick={()=>void resolveThread(String(threadDetail.public_id))}>Selesaikan</button>}</form>}</>:<p>Pilih percakapan untuk melihat pesan.</p>}</div>
    </div>}
    {data!==null&&view!=='tickets'&&view!=='sync'&&view!=='questions'&&view!=='students'&&view!=='reports'&&view!=='results'&&<pre style={{...card,overflow:'auto',maxHeight:'60vh'}}>{JSON.stringify(data,null,2)}</pre>}
    {view==='sync'&&data!==null&&<pre style={{...card,overflow:'auto',maxHeight:'60vh'}}>{JSON.stringify(data,null,2)}</pre>}
    {view==='students'&&data!==null&&<pre style={{...card,overflow:'auto',maxHeight:'60vh'}}>{JSON.stringify(data,null,2)}</pre>}
  </section>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

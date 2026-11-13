import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './lib/api';
import { claimDelayMs } from './lib/load-shape';
import type { WaitingView } from './lib/waiting-room';
import './styles/exam-admission.css';

const labels:Record<WaitingView['status'],string>={NOT_JOINED:'Belum masuk antrean',WAITING:'Menunggu giliran',ADMITTED:'Giliran Anda sudah dibuka',IN_EXAM:'Memulihkan sesi ujian',FINISHED:'Ujian sudah selesai',ABANDONED:'Kehadiran di antrean berakhir',EXPIRED:'Kesempatan masuk sudah berakhir'};

export function ExamWaitingRoom({examId,initial,examName,onReady,onCancel}:{examId:number;initial:WaitingView;examName:string;onReady:(token:string)=>Promise<void>;onCancel:()=>void|Promise<void>}) {
  const [view,setView]=useState(initial),[notice,setNotice]=useState(''),[connection,setConnection]=useState('Menghubungkan'),[busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const ready=useRef(onReady);ready.current=onReady;
  const current=useRef(initial);
  useEffect(()=>{
    let active=true,claiming=false,terminal=false,realtime=false;
    let stream:EventSource|null=null;
    let pollTimer=0,heartbeatTimer=0,reconnectTimer=0,claimTimer=0;
    const heartbeatDelay=()=>Math.max(2000,Math.min(20000,current.current.heartbeat_timeout_ms/3))*(0.9+Math.random()*0.2);
    const path=`/api/student/exams/${examId}/waiting`;
    function error(error:unknown){
      if(!active)return;
      if(error instanceof ApiError && error.statusCode===401){terminal=true;setNotice('Sesi login sudah berakhir. Silakan masuk kembali.');stream?.close();return;}
      setNotice(error instanceof Error?error.message:'Koneksi terputus. Mencoba kembali...');
      setConnection('Polling cadangan');
    }
    async function accept(next:WaitingView){
      if(!active || terminal)return;
      current.current=next;setView(next);
      if(next.status==='FINISHED'){terminal=true;stream?.close();setNotice('Ujian sudah selesai. Kembali ke jadwal untuk melihat hasil.');return;}
      if(['ABANDONED','EXPIRED'].includes(next.status)){setNotice('Anda dapat masuk antrean kembali dengan nomor baru.');return;}
      setNotice('');
      if((next.status==='ADMITTED' || next.status==='IN_EXAM') && next.admit_token && !claiming){
        claiming=true;setBusy(true);
        const token=next.admit_token;
        // Tahap 3: sebar claim di dalam jendela batch admission. Tanpa jitter,
        // 300 siswa yang di-admit bersamaan melakukan claim pada detik yang sama.
        const delay=next.status==='ADMITTED'?claimDelayMs(next.batch_interval_ms):0;
        const runClaim=async(attemptCount=1)=>{
          if(!active||terminal||current.current.admit_token!==token){claimTimer=0;claiming=false;if(active)setBusy(false);return;}
          try{
            await ready.current(token);
            claimTimer=0;
          }catch(cause){
            error(cause);
            if(active && !terminal && current.current.admit_token===token && attemptCount<=5){
              const retryDelay=Math.min(8000,1500*(2**(attemptCount-1)))*(0.8+Math.random()*0.4);
              claimTimer=window.setTimeout(()=>{void runClaim(attemptCount+1);},retryDelay);
              return;
            }
            claimTimer=0;
          }finally{
            if(!claimTimer){claiming=false;if(active)setBusy(false);}
          }
        };
        if(delay>0)claimTimer=window.setTimeout(()=>{void runClaim();},delay);
        else void runClaim();
      }
    }
    async function poll(){
      if(!active || terminal)return;
      try{await accept(await api<WaitingView>(`${path}/status`,{timeoutMs:10000}));}catch(cause){error(cause);}
      if(active && !terminal)pollTimer=window.setTimeout(()=>{void poll();},realtime?30000:4500+Math.random()*1000);
    }
    function connect(){
      if(!active || terminal || typeof EventSource==='undefined'){setConnection('Polling cadangan');return;}
      const ticket=current.current.stream_ticket;
      if(!ticket){reconnectTimer=window.setTimeout(connect,10000);return;}
      stream=new EventSource(`${path}/events?ticket=${encodeURIComponent(ticket)}`);
      stream.onopen=()=>{if(active){realtime=true;setConnection('Realtime aktif');}};
      stream.addEventListener('status',event=>{try{void accept(JSON.parse((event as MessageEvent).data));}catch(cause){error(cause);}});
      stream.addEventListener('expired',()=>{terminal=true;setNotice('Sesi login sudah berakhir. Silakan masuk kembali.');stream?.close();});
      stream.onerror=()=>{realtime=false;stream?.close();if(active && !terminal){setConnection('Polling cadangan');window.clearTimeout(pollTimer);pollTimer=window.setTimeout(()=>{void poll();},1000+Math.random()*2000);reconnectTimer=window.setTimeout(connect,10000+Math.random()*10000);}};
    }
    async function heartbeat(){
      if(!active || terminal)return;
      try{await accept(await api<WaitingView>(`${path}/heartbeat`,{method:'POST',body:{},timeoutMs:10000}));}catch(cause){error(cause);}
      if(active && !terminal)heartbeatTimer=window.setTimeout(()=>{void heartbeat();},heartbeatDelay());
    }
    void accept(current.current);void poll();connect();
    heartbeatTimer=window.setTimeout(()=>{void heartbeat();},heartbeatDelay());
    return()=>{active=false;stream?.close();window.clearTimeout(pollTimer);window.clearTimeout(heartbeatTimer);window.clearTimeout(reconnectTimer);window.clearTimeout(claimTimer);};
  },[examId,revision]);

  async function rejoin(){
    setBusy(true);setNotice('');
    try{const next=await api<WaitingView>(`/api/student/exams/${examId}/waiting/join`,{method:'POST',body:{rejoin:true},timeoutMs:10000});current.current=next;setView(next);setRevision(value=>value+1);}
    catch(error){setNotice(error instanceof Error?error.message:'Belum bisa masuk antrean.');}
    finally{setBusy(false);}
  }
  const closed=({CLOSED:'Antrean sedang dijeda oleh petugas. Posisi Anda tetap tersimpan.',NOT_OPEN:'Ujian belum dibuka.',ENDED:'Jadwal masuk ujian sudah berakhir.',DISABLED:'Ujian sedang tidak aktif.'} as Record<string,string>)[view.queue_state];
  return <section className="exam-waiting-room" aria-labelledby="exam-waiting-title"><div className="exam-waiting-card" aria-busy={busy}>
    <div className="exam-waiting-animation" aria-hidden="true"><span/><span/><span/><svg width="38" height="38" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10 5h20M10 35h20M12 5v6c0 5 5 7 8 9-3 2-8 4-8 9v6M28 5v6c0 5-5 7-8 9 3 2 8 4 8 9v6"/></svg></div>
    <p className="exam-waiting-eyebrow">RUANG TUNGGU UJIAN</p><h1 id="exam-waiting-title">{labels[view.status]}</h1><p className="exam-waiting-name">{examName}</p>
    {view.status==='WAITING' && <><p>Silakan tunggu, sesi Anda akan segera dimulai...</p><div className="waiting-position-grid" aria-live="polite"><div><strong>{view.queue_number ?? '—'}</strong><span>Nomor antrean</span></div><div><strong>{view.position ?? '—'}</strong><span>Posisi saat ini</span></div><div><strong>{view.ahead ?? '—'}</strong><span>Siswa di depan</span></div></div>{view.estimated_wait_seconds!==undefined && <p>Perkiraan giliran: sekitar {Math.max(1,Math.ceil(view.estimated_wait_seconds/60))} menit.</p>}</>}
    {(view.status==='ADMITTED' || view.status==='IN_EXAM') && <p>Sedang membuka soal. Durasi ujian dimulai setelah proses masuk berhasil.</p>}
    {closed && <p role="status">{closed}</p>}
    <p className="waiting-connection" role="status"><span aria-hidden="true"/>{connection}</p>
    <p>Jangan tutup atau refresh halaman. Posisi Anda tetap aman.</p><small>Jika koneksi terputus, kembali sebelum {Math.round(view.heartbeat_timeout_ms/1000)} detik agar nomor tetap tersimpan.</small>
    <p className="exam-waiting-notice" role="status" aria-live="polite">{notice}</p>
    {['ABANDONED','EXPIRED','NOT_JOINED'].includes(view.status) && <button type="button" className="btn btn-primary" disabled={busy || view.queue_state!=='OPEN'} onClick={()=>void rejoin()}>Masuk antrean lagi</button>}
    <button className="btn btn-secondary" type="button" disabled={busy} onClick={()=>void onCancel()}>Keluar dari antrean</button>
  </div></section>;
}

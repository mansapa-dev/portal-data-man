import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, beacon, mutationId } from './lib/api';
import { submitJitterMs } from './lib/load-shape';
import { enterFullscreenNow, isFullscreenActive, isFullscreenSupported, setExamMode } from './lib/exam-mode';
import { createFacePresence, type FacePresenceStatus } from './lib/face-presence';
import { createFaceReporter } from './lib/face-report';
import { AWAY_THRESHOLD_MS, createAwayEpisode } from './lib/away-episode';
import { capabilitiesToApiPayload, detectCapabilities } from './lib/device-capability';
import { createSecurityEventBatcher, makeEventKey, type SecurityEventBatcher } from './lib/security-events';
import { createExamRecorder } from './lib/recorder';
import { createUploadQueue } from './lib/upload-queue';
import type { PreflightResult } from './ExamPreflight';

type ViolationType = 'TAB_HIDDEN'|'WINDOW_BLUR'|'FULLSCREEN_EXIT'|'SCREENSHOT_ATTEMPT'|'COPY_ATTEMPT'|'PASTE_ATTEMPT'|'CUT_ATTEMPT'|'CONTEXT_MENU_ATTEMPT'|'DEVTOOLS_SHORTCUT'|'BROWSER_SHORTCUT'|'SPLIT_SCREEN_SUSPECTED'|'MULTI_TAB'|'TEXT_SELECTION'|'APP_OVERLAY'|'FACE_ABSENT'|'FACE_CAMERA_OFF'|'OTHER';

type MathJaxEngine = { startup?: { promise?: Promise<unknown> }; typesetPromise?: (elements: HTMLElement[]) => Promise<void>; typesetClear?: (elements: HTMLElement[]) => void };
let mathQueue: Promise<void> = Promise.resolve();
function ActiveQuestionMath({question, children}: {question: ExamQuestion; children: React.ReactNode}) {
 const container = useRef<HTMLDivElement>(null);
 useLayoutEffect(() => {
  const element = container.current;
  if (!element) return;
  let active = true;
  // Dekode gambar secara asinkron agar layar tidak tersendat saat soal berisi foto.
  element.querySelectorAll('img').forEach((image) => { image.decoding = 'async'; });
  // Unicode text and images render natively. Only invoke MathJax when the
  // question or an option contains supported TeX delimiters or MathML.
  const text = element.textContent ?? '';
  const needsMath = Boolean(element.querySelector('math')) || text.includes('\\(') || text.includes('\\[') || text.includes('$$');
  if (!needsMath) return;
  const script = document.querySelector<HTMLScriptElement>('script[src*="mathjax@3/"]');
  const ready = async () => {
   let engine = (window as unknown as {MathJax?: MathJaxEngine}).MathJax;
   if (!engine?.startup?.promise && script) await new Promise<void>(resolve => {
    let timer = 0;
    const done = () => { window.clearTimeout(timer); script.removeEventListener('load', done); script.removeEventListener('error', done); resolve(); };
    script.addEventListener('load', done, {once:true});
    script.addEventListener('error', done, {once:true});
    timer = window.setTimeout(done, 15000);
   });
   engine = (window as unknown as {MathJax?: MathJaxEngine}).MathJax;
   await engine?.startup?.promise;
   return engine;
  };
  void ready().then(engine => {
   if (!active || !element.isConnected || !engine?.typesetPromise) return;
   mathQueue = mathQueue.catch(() => {}).then(async () => {
    if (active && element.isConnected) await engine.typesetPromise!([element]);
   }).catch(error => { console.warn('MathJax typesetting failed', error); });
  }).catch(error => { console.warn('MathJax startup failed', error); });
  return () => {
   active = false;
   (window as unknown as {MathJax?: MathJaxEngine}).MathJax?.typesetClear?.([element]);
   mathQueue = mathQueue.then(() => { (window as unknown as {MathJax?: MathJaxEngine}).MathJax?.typesetClear?.([element]); });
  };
 }, [question]);
 return <div ref={container}>{children}</div>;
}

export type ExamQuestion={id:number;tipe:string;pertanyaan:string;opsi:{key:string;text:string}[];poin:number};
export type ExamAttempt={attempt_id:string;exam:{id:number;nama_ujian:string};expires_at:string;server_time?:string;soal:ExamQuestion[];jawaban:{question_id:number;answer:string|null;is_flagged:boolean;revision:number}[]};
export type ExamResult={status?:string;nilai?:number|string|null;benar?:number|null;salah?:number|null;kosong?:number|null;jumlah_soal?:number|null;is_remedial?:boolean;score_cap?:number|null;follow_up_type?:string|null;submission_state?:string|null};

export function StudentExam({attempt,studentName,studentNisn,answers,flags,busy,saveState='saved',message,change,toggleFlag,retrySave,submit,onTerminated,onHelp,helpOpen=false,preflightResult=null,recordingEnabled=false,segmentDurationSeconds=60,videoBitrate=500_000,children}:{attempt:ExamAttempt;studentName:string;studentNisn?:string;answers:Record<number,string>;flags:Record<number,boolean>;busy:boolean;saveState?:'saved'|'saving'|'error';message?:string;change:(question:ExamQuestion,value:string)=>void;toggleFlag:(question:ExamQuestion)=>void;retrySave:()=>Promise<void>;submit:(finalizeOnly?:boolean)=>Promise<void>;onTerminated:(result:ExamResult|null)=>void;onHelp:()=>void;helpOpen?:boolean;preflightResult?:PreflightResult|null;recordingEnabled?:boolean;segmentDurationSeconds?:number;videoBitrate?:number;children?:React.ReactNode}){
 const [remaining,setRemaining]=useState(()=>Math.max(0,Math.ceil((Date.parse(attempt.expires_at)-Date.now()-(attempt.server_time?Date.parse(attempt.server_time)-Date.now():0))/1000))),[warning,setWarning]=useState(''),[current,setCurrent]=useState(0),[submitOpen,setSubmitOpen]=useState(false),[expiryFailed,setExpiryFailed]=useState(false),[mapOpen,setMapOpen]=useState(false);const lastEvent=useRef<Record<string,number>>({}),submitting=useRef(false),fullscreenRequested=useRef(false),submitRef=useRef(submit),terminationRef=useRef(onTerminated);
 const [uploadPending,setUploadPending]=useState(0);
 const [recordingActive,setRecordingActive]=useState(false);
 const [fullscreenActive,setFullscreenActive]=useState(()=>isFullscreenActive());
 const batcherRef=useRef<SecurityEventBatcher|null>(null);
 // Pengawasan kehadiran wajah berjalan lokal di perangkat. Status dipakai untuk
 // chip & banner; recordRef menjadi jembatan ke pencatat pelanggaran di bawah.
 const [faceStatus,setFaceStatus]=useState<FacePresenceStatus>('starting');
 const [faceNotice,setFaceNotice]=useState('');
 const recordRef=useRef<((type:ViolationType)=>void)|null>(null);
 // Dialog izin kamera Android memindahkan fokus jendela sesaat. Beri jeda agar
 // dialog sistem tidak salah dihitung sebagai siswa keluar dari layar ujian.
 const faceSetupGrace=useRef(Date.now()+20_000);
 const faceInfoShown=useRef(false);
 // Escape episodes (tekan tombol home, overlay aplikasi lain, blur) sering
 // memicu beberapa sinyal hampir bersamaan (vitamin TAB_HIDDEN + APP_OVERLAY +
 // WINDOW_BLUR). Semua sinyal dalam satu episode memakai satu event_key yang sama
 // sehingga kombinasi unik server (uq event_key per attempt) menghitungnya hanya
 // SATU pelanggaran. Kunci dibuat ulang bila episode berjarak > 4 detik.
 const escapeKey=useRef(''),escapeKeyAt=useRef(0);
 const currentQuestion=useRef(0);currentQuestion.current=current+1;
 const submitCancelButton=useRef<HTMLButtonElement>(null),submitTrigger=useRef<HTMLButtonElement|null>(null);
 submitRef.current=submit;
 terminationRef.current=onTerminated;
 useEffect(()=>{if(!submitOpen)return;submitCancelButton.current?.focus();const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy)setSubmitOpen(false);if(event.key==='Tab'){const buttons=submitCancelButton.current?.closest('.student-submit-dialog')?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');if(!buttons?.length)return;const first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};document.addEventListener('keydown',onKeyDown);return()=>{document.removeEventListener('keydown',onKeyDown);submitTrigger.current?.focus();};},[submitOpen,busy]);
 const offset=useRef(attempt.server_time?Date.parse(attempt.server_time)-Date.now():0);
 useEffect(()=>{offset.current=attempt.server_time?Date.parse(attempt.server_time)-Date.now():0;submitting.current=false;setExpiryFailed(false);let expiryStarted=false,expiryTimer=0;const tick=()=>{const seconds=Math.max(0,Math.ceil((Date.parse(attempt.expires_at)-Date.now()-offset.current)/1000));setRemaining(seconds);if(seconds===0&&!expiryStarted&&!submitting.current){expiryStarted=true;submitting.current=true;setSubmitOpen(false);
  // Tahap 3: attempts yang claim terlambat berbagi ends_at yang sama, sehingga
  // auto-submit bisa menumpuk jadi ribuan request pada satu detik. Sebarkan
  // 0..2 dtk; server tetap memfinalisasi hanya jawaban yang sudah tersimpan.
  const fire=()=>{void submitRef.current(true).catch(()=>{submitting.current=false;setExpiryFailed(true);setWarning('Waktu habis. Hasil dihitung dari jawaban yang berhasil tersimpan.');});};
  const jitter=submitJitterMs();
  if(jitter>0)expiryTimer=window.setTimeout(fire,jitter);else fire();}};tick();const timer=window.setInterval(tick,1000);return()=>{clearInterval(timer);window.clearTimeout(expiryTimer);};},[attempt.attempt_id]);
 // Anti layar mati sendiri: selama attempt aktif, minta shell Android menahan
 // layar tetap menyala (FLAG_KEEP_SCREEN_ON). Layar yang mati oleh screen timeout
 // memicu pause/kehilangan fokus yang tercatat pelanggaran, padahal bukan nahas
 // siswa. Pada browser biasa (tanpa shell), pakai Screen Wake Lock API sebagai
 // pengganti; lock akan hilang otomatis saat tab tertidur, jadi diambil ulang.
 useEffect(()=>{
  type HostWindow=Window&{ArenaApp?:{setKeepScreenOn?:(value:boolean)=>void}};
  type WakeLockProvider=Navigator&{wakeLock?:{request:(type:'screen')=>Promise<{release:()=>Promise<void>}>}};
  const host=window as HostWindow;
  const wake=globalThis.navigator as WakeLockProvider|null;
  let sentinel:{release:()=>Promise<void>}|null=null;
  let disposed=false;
  let lastHoldAt=0;
  const hold=()=>{
   lastHoldAt=Date.now();
   try{void sentinel?.release?.().catch(()=>{});}catch{/* lock sudah coret oleh browser */}
   sentinel=null;
   if(document.hidden)return;
   try{host.ArenaApp?.setKeepScreenOn?.(true);}catch{/* shell Android lama/tidak ada */}
   try{void wake?.wakeLock?.request('screen').then((sentinelValue)=>{if(disposed){void sentinelValue.release?.();return;}sentinel=sentinelValue;}).catch(()=>{/* syarat layar/context tidak terpenuhi; silakan coba lagi setelah interaksi */});}catch{/* wake lock tidak tersedia */}
  };
  hold();
  // Wake lock bisa dicabut browser kapan saja (tab sempat tidur, hemat daya,
  // dsb). Pakai interaksi selanjutnya siswa — ketukan layar, kembali ke tab —
  // sebagai peluang grab ulang dengan throttle 5 detik biar tidak turnus.
  const reacquire=()=>{
   const now=Date.now();
   if(now-lastHoldAt>5000)hold();
  };
  document.addEventListener('visibilitychange',reacquire);
  document.addEventListener('pointerdown',reacquire,{passive:true});
  document.addEventListener('focus',reacquire);
  return()=>{
   disposed=true;
   document.removeEventListener('visibilitychange',reacquire);
   document.removeEventListener('pointerdown',reacquire);
   document.removeEventListener('focus',reacquire);
   try{void sentinel?.release?.();}catch{/* sudah dilepas */}
   try{host.ArenaApp?.setKeepScreenOn?.(false);}catch{/* shell lama tanpa bridge */}
  };
 },[attempt.attempt_id]);
 useEffect(()=>{
  let active=true,constrained=false,wasFullscreen=false,blurTimer=0,hiddenTimer=0,hostTimer=0,pingTimer=0,viewportTimer=0,multiTabCooldown=0,leaving=false;
  // Episode "keluar layar" baru dicatat setelah benar-benar lebih dari 5 detik.
  // Refresh/reload yang singkat (termasuk dua kali berturut-turut) tidak pernah
  // melewati ambang ini, sedangkan layar HP yang mati >5 detik tetap tercatat.
  const hiddenEpisode=createAwayEpisode();
  const hostEpisode=createAwayEpisode();
  const record=(type:ViolationType)=>{
   if(submitting.current||leaving)return;
   // Dialog izin kamera Android memunculkan jendela sistem yang membuat halaman
   // kehilangan fokus. Jangan catat sinyal keluar-layar selama kamera disiapkan.
   if(Date.now()<faceSetupGrace.current&&(type==='TAB_HIDDEN'||type==='WINDOW_BLUR'||type==='APP_OVERLAY'||type==='FULLSCREEN_EXIT'))return;
   const now=Date.now();if(now-(lastEvent.current[type]??0)<5000)return;lastEvent.current[type]=now;
   // Satu episode "keluar dari layar" (tekan home, overlay asisten, blur) sering
   // memicu beberapa sinyal hampir bersamaan. Semua sinyal grup ini memakai satu
   // event_key yang sama dalam jendela 4 detik, sehingga unik (attempt,event_key)
   // di server menghitung episode itu hanya SATU pelanggaran.
   let eventKey: string;
   if(type==='TAB_HIDDEN'||type==='WINDOW_BLUR'||type==='FULLSCREEN_EXIT'||type==='MULTI_TAB'||type==='SPLIT_SCREEN_SUSPECTED'||type==='APP_OVERLAY'){
    if(now-escapeKeyAt.current>4000){escapeKey.current=mutationId();escapeKeyAt.current=now;}
    eventKey=escapeKey.current;
   } else eventKey=mutationId();
   void api<{count:number;threshold?:number;action?:string;terminated:boolean;hasil?:ExamResult}>(`/api/student/exams/${attempt.exam.id}/violations`,{method:'POST',keepalive:true,body:{event_key:eventKey,type,client_occurred_at:new Date().toISOString(),question_no:currentQuestion.current}}).then(result=>{
    if(!active)return;
    if(result.terminated){submitting.current=true;terminationRef.current({...result.hasil,status:'TERMINATED'});}
    else if(type==='FACE_ABSENT'||type==='FACE_CAMERA_OFF'){/* banner kamera yang menangani pesan */}
    else if(['PASTE_ATTEMPT','CUT_ATTEMPT','CONTEXT_MENU_ATTEMPT','DEVTOOLS_SHORTCUT','BROWSER_SHORTCUT','TEXT_SELECTION'].includes(type))setWarning(`Sinyal dicatat untuk ditinjau pengawas; setiap tiga kejadian serupa dihitung satu pelanggaran (${result.count}/${result.threshold??3}).`);
    else setWarning(`Pelanggaran tercatat (${result.count}/${result.threshold??3}). Tetap di halaman ujian dan ikuti arahan pengawas.`);
   }).catch(error=>{if(active){beacon(`/api/student/exams/${attempt.exam.id}/violations`,{event_key:eventKey,type,client_occurred_at:new Date().toISOString(),question_no:currentQuestion.current});if(type!=='FACE_ABSENT'&&type!=='FACE_CAMERA_OFF')setWarning(`Sinyal belum tercatat: ${(error as Error).message}`);}});
  };
  recordRef.current=record;
  const visibility=()=>{
   window.clearTimeout(hiddenTimer);
   if(document.hidden&&!leaving){
    // Catat waktu mulai tersembunyi lalu tunda 5 detik. Bila halaman kembali
    // terlihat sebelum ambang (refresh, pindah jendela sekilas), tidak ada
    // pelanggaran. Bila timer sempat dibekukan sistem, durasi dihitung ulang
    // dari waktu mulai episode saat halaman kembali terlihat.
    hiddenEpisode.start(Date.now());
    hiddenTimer=window.setTimeout(recordHidden,AWAY_THRESHOLD_MS);
    return;
   }
   recordHidden();
   hiddenEpisode.cancel();
   hostVisible();
  };
  const recordHidden=()=>{
   if(leaving)return;
   if(hiddenEpisode.settle(Date.now()))record('TAB_HIDDEN');
  };
  // Bridge dari shell Android (arena-host-hidden): shell menyuntikkan event ini
  // tiap kali host berhenti (onPause/onUserLeaveHint) atau kehilangan fokus —
  // mis. overlay Gemini/asisten sistem muncul di atas layar ujian. Sinyal ini
  // memakai ambang 5 detik yang sama: overlay sesaat bukan pelanggaran, layar
  // mati/keluar aplikasi lebih dari 5 detik tetap tercatat. host-visible
  // membatalkan timer ketika pengguna kembali.
  const recordHostAway=()=>{
   if(leaving)return;
   if(hostEpisode.settle(Date.now()))record('APP_OVERLAY');
  };
  const hostHidden=()=>{
   if(leaving)return;
   hostEpisode.start(Date.now());
   window.clearTimeout(hostTimer);
   hostTimer=window.setTimeout(recordHostAway,AWAY_THRESHOLD_MS);
  };
  const hostVisible=()=>{
   window.clearTimeout(hostTimer);
   recordHostAway();
   hostEpisode.cancel();
  };
  // Shell Android mengirim durasi host pergi yang diukur native (timer JS bisa
  // dibekukan saat layar mati). Bila sudah melewati 5 detik, catat satu sinyal
  // APP_OVERLAY; sinyal TAB_HIDDEN dari visibilitychange akan menyatu dengan
  // event_key yang sama sehingga server tetap menghitungnya satu pelanggaran.
  const hostAway=(event:Event)=>{
   window.clearTimeout(hostTimer);
   hostEpisode.cancel();
   if(leaving)return;
   const detail=(event as CustomEvent<{durationMs?:number}>).detail;
   if(Number(detail?.durationMs??0)>=AWAY_THRESHOLD_MS)record('APP_OVERLAY');
  };
  // Refresh (F5), reload, atau menutup tab bukan pelanggaran. Tandai teardown
  // halaman agar sinyal hidden/blur yang menyusul tidak ikut tercatat; jangan
  // pernah mengirim event pelanggaran dari pagehide/beforeunload.
  const leavingPage=()=>{leaving=true;hiddenEpisode.cancel();hostEpisode.cancel();window.clearTimeout(hiddenTimer);window.clearTimeout(hostTimer);window.clearTimeout(blurTimer);};
  const clipboard=(type:'COPY_ATTEMPT'|'PASTE_ATTEMPT'|'CUT_ATTEMPT')=>(event:ClipboardEvent)=>{event.preventDefault();record(type);};
  const contextMenu=(event:MouseEvent)=>{event.preventDefault();record('CONTEXT_MENU_ATTEMPT');};
  const blockSelection=(event:Event)=>{
   // Input/textarea (soal isian) tetap boleh diseleksi dan diketik.
   if(event.target instanceof HTMLElement&&event.target.matches('input,textarea,[contenteditable="true"]'))return;
   event.preventDefault();
  };
  const selectionChange=()=>{
   const selection=window.getSelection();
   if(selection&&selection.rangeCount>0&&!selection.isCollapsed&&String(selection).length>0){
    // iOS Safari sering meninggalkan caret dengan range aktif; hanya seleksi
    // nyata (bukan caret) yang dicatat, lalu dihapus agar loupe tidak muncul.
    selection.removeAllRanges();
    record('TEXT_SELECTION');
   }
  };
  const keydown=(event:KeyboardEvent)=>{
   if(event.repeat)return;
   const key=event.key.toLowerCase(),platform=navigator.platform.toLowerCase();
   const screenshot=event.key==='PrintScreen'||event.code==='PrintScreen'||(platform.includes('win')&&event.metaKey&&event.shiftKey&&key==='s')||(platform.includes('mac')&&event.metaKey&&event.shiftKey&&['3','4','5'].includes(key));
   if(screenshot){event.preventDefault();record('SCREENSHOT_ATTEMPT');return;}
   const modifier=event.ctrlKey||event.metaKey;
   if((modifier&&event.shiftKey&&['i','j','c'].includes(key))||key==='f12'){
    event.preventDefault();record('DEVTOOLS_SHORTCUT');return;
   }
   if(modifier&&key==='c'){event.preventDefault();record('COPY_ATTEMPT');}
   else if(modifier&&key==='x'){event.preventDefault();record('CUT_ATTEMPT');}
   else if(modifier&&key==='v'){event.preventDefault();record('PASTE_ATTEMPT');}
   else if(modifier&&['p','s','u'].includes(key)){event.preventDefault();record('BROWSER_SHORTCUT');}
  };
  const copy=clipboard('COPY_ATTEMPT'),paste=clipboard('PASTE_ATTEMPT'),cut=clipboard('CUT_ATTEMPT');
   const fullscreenchange=()=>{
    const activeNow=isFullscreenActive();
    setFullscreenActive(activeNow);
    if(activeNow)wasFullscreen=true;
    else if(fullscreenRequested.current)record('FULLSCREEN_EXIT');
   };
   // Multi-tab guard: two exam tabs on one device are reported through a local
  // BroadcastChannel (no server chatter while a single tab runs). Each tab pings
  // every 5 s; hearing another tab's ping (or its join) counts as MULTI_TAB and is
  // re-reported at most every 25 s so the server only sees a few rows per offender.
  let channel:BroadcastChannel|null=null;
  const tabId=Math.random().toString(36).slice(2)+Date.now().toString(36);
  const reportMultiTab=()=>{const now=Date.now();if(now<multiTabCooldown)return;multiTabCooldown=now+25000;record('MULTI_TAB');};
  try{
   if(typeof BroadcastChannel==='function'){
    channel=new BroadcastChannel(`arena-attempt-${attempt.attempt_id}`);
    channel.onmessage=(event:MessageEvent)=>{
     if(!active||!event.data||typeof event.data!=='object'||event.data.from===tabId)return;
     if(event.data.type==='ping'||event.data.type==='join')reportMultiTab();
    };
    channel.postMessage({type:'join',from:tabId});
    pingTimer=window.setInterval(()=>channel?.postMessage({type:'ping',from:tabId}),5000);
   }
   }catch{ /* BroadcastChannel unavailable in this WebView; tab-hidden tracking still applies */ }
   const viewport=()=>{
   window.clearTimeout(viewportTimer);
   viewportTimer=window.setTimeout(()=>{
    const focused=typeof document.hasFocus!=='function'||document.hasFocus();
    const editable=document.activeElement?.matches('input,textarea,select,[contenteditable="true"]');
    const scale=window.visualViewport?.scale??1;
    // Desktop splits are only judged after the student used the fullscreen mode this
    // app provides; an idle small browser window on a computer is not evidence.
    const enforced=document.fullscreenElement||fullscreenRequested.current||wasFullscreen||navigator.maxTouchPoints>=1;
    if(document.hidden||!focused||!enforced||editable||Math.abs(scale-1)>0.05||Math.min(screen.width,screen.height)>600||!screen.width||!screen.height){constrained=false;return;}
    const next=window.innerWidth/screen.width<0.72||window.innerHeight/screen.height<0.58;
    if(next&&!constrained)record('SPLIT_SCREEN_SUSPECTED');constrained=next;
   },1500);
  };
  const blur=()=>{
   window.clearTimeout(blurTimer);
   // Kehilangan fokus baru dicatat bila bertahan lebih dari 5 detik. Refresh,
   // dialog izin kamera, atau notifikasi singkat tidak dihitung; pindah ke
   // aplikasi lain / layar mati lebih dari 5 detik tetap tercatat.
   blurTimer=window.setTimeout(()=>{if(typeof document.hasFocus!=='function'||!document.hasFocus())record('WINDOW_BLUR');},AWAY_THRESHOLD_MS);
  };
  const focus=()=>{window.clearTimeout(blurTimer);hostVisible();viewport();};
  const orientation=()=>{constrained=false;window.clearTimeout(viewportTimer);viewportTimer=window.setTimeout(viewport,1800);};
  // iOS Safari: blokir pinch-zoom (event gesture* hanya ada di Safari) agar siswa
  // tidak menyusutkan layar untuk membuka dua kolom halaman dalam satu tab.
  const blockGesture=(event:Event)=>{event.preventDefault();};
  document.addEventListener('visibilitychange',visibility);document.addEventListener('arena-host-hidden',hostHidden);document.addEventListener('arena-host-visible',hostVisible);document.addEventListener('arena-host-away',hostAway);document.addEventListener('copy',copy,true);document.addEventListener('paste',paste,true);document.addEventListener('cut',cut,true);document.addEventListener('contextmenu',contextMenu,true);document.addEventListener('selectstart',blockSelection,true);document.addEventListener('dragstart',blockSelection,true);document.addEventListener('selectionchange',selectionChange);document.addEventListener('gesturestart',blockGesture);document.addEventListener('gesturechange',blockGesture);document.addEventListener('keydown',keydown,true);document.addEventListener('fullscreenchange',fullscreenchange);document.addEventListener('webkitfullscreenchange',fullscreenchange);
  window.addEventListener('resize',viewport);window.addEventListener('orientationchange',orientation);window.addEventListener('pagehide',leavingPage);window.addEventListener('beforeunload',leavingPage);
  // iOS Safari: pinch-zoom mengubah visualViewport tanpa window resize.
  window.visualViewport?.addEventListener('resize',viewport);
  window.visualViewport?.addEventListener('scroll',viewport);
  window.addEventListener('blur',blur);window.addEventListener('focus',focus);viewport();
  return()=>{active=false;recordRef.current=null;document.removeEventListener('visibilitychange',visibility);document.removeEventListener('arena-host-hidden',hostHidden);document.removeEventListener('arena-host-visible',hostVisible);document.removeEventListener('arena-host-away',hostAway);document.removeEventListener('copy',copy,true);document.removeEventListener('paste',paste,true);document.removeEventListener('cut',cut,true);document.removeEventListener('contextmenu',contextMenu,true);document.removeEventListener('selectstart',blockSelection,true);document.removeEventListener('dragstart',blockSelection,true);document.removeEventListener('selectionchange',selectionChange);document.removeEventListener('gesturestart',blockGesture);document.removeEventListener('gesturechange',blockGesture);document.removeEventListener('keydown',keydown,true);document.removeEventListener('fullscreenchange',fullscreenchange);document.removeEventListener('webkitfullscreenchange',fullscreenchange);window.removeEventListener('resize',viewport);window.removeEventListener('orientationchange',orientation);window.removeEventListener('pagehide',leavingPage);window.removeEventListener('beforeunload',leavingPage);window.clearTimeout(hiddenTimer);window.clearTimeout(hostTimer);window.visualViewport?.removeEventListener('resize',viewport);window.visualViewport?.removeEventListener('scroll',viewport);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);window.clearTimeout(viewportTimer);window.clearTimeout(blurTimer);window.clearInterval(pingTimer);try{channel?.close();}catch{/* already closed */}};
 },[attempt.attempt_id]);
 // Laporkan kapabilitas perangkat & siklus hidup browser (freeze/resume/network) ke event engine.
 useEffect(()=>{
  const caps=detectCapabilities();
  void api(`/api/student/exams/${attempt.exam.id}/device-session`,{method:'POST',body:{attempt_id:attempt.attempt_id,...capabilitiesToApiPayload(caps)}}).catch(()=>{/* non-fatal */});
  const batcher=createSecurityEventBatcher({
   attemptId:attempt.attempt_id,
   examId:attempt.exam.id,
   send:(events)=>api(`/api/student/exams/${attempt.exam.id}/security/events`,{method:'POST',keepalive:true,body:{attempt_id:attempt.attempt_id,events}}),
  });
  batcherRef.current=batcher;
  const onFreeze=()=>batcher.push({event_key:makeEventKey('PAGE_SUSPENDED'),event_type:'PAGE_SUSPENDED',client_occurred_at:new Date().toISOString()});
  const onResume=()=>void batcher.flush();
  const onOffline=()=>batcher.push({event_key:makeEventKey('NETWORK_INTERRUPTED'),event_type:'NETWORK_INTERRUPTED',client_occurred_at:new Date().toISOString()});
  const onOnline=()=>{batcher.push({event_key:makeEventKey('NETWORK_RECOVERED'),event_type:'NETWORK_RECOVERED',client_occurred_at:new Date().toISOString()});void batcher.flush();};
  const onPageShow=(e:PageTransitionEvent)=>{if(e.persisted){batcher.push({event_key:makeEventKey('PAGE_RELOADED'),event_type:'PAGE_RELOADED',client_occurred_at:new Date().toISOString()});void batcher.flush();}};
  document.addEventListener('freeze',onFreeze);
  document.addEventListener('resume',onResume);
  window.addEventListener('offline',onOffline);
  window.addEventListener('online',onOnline);
  window.addEventListener('pageshow',onPageShow);
  return()=>{
   document.removeEventListener('freeze',onFreeze);
   document.removeEventListener('resume',onResume);
   window.removeEventListener('offline',onOffline);
   window.removeEventListener('online',onOnline);
   window.removeEventListener('pageshow',onPageShow);
   void batcher.flush();
   batcher.stop();
   batcherRef.current=null;
  };
 },[attempt.attempt_id,attempt.exam.id]);
 // Mode ujian: kunci navigasi + fullscreen selama attempt aktif. Dilepas saat
 // siswa membuka bantuan, ada error simpan, waktu habis, atau sesi berakhir —
 // jadi mereka hanya bisa keluar ketika benar-benar membutuhkan bantuan.
 const expired=remaining===0;
 useEffect(()=>{const active=!helpOpen&&!expired&&saveState!=='error';fullscreenRequested.current=active;setExamMode(active);},[attempt.attempt_id,helpOpen,expired,saveState]);
 useEffect(()=>()=>{fullscreenRequested.current=false;setExamMode(false);},[]);
 // Pengawasan kehadiran wajah: kamera diproses sepenuhnya di perangkat siswa.
 // Server hanya menerima sinyal status wajah (tanpa foto/video), dan hanya
 // untuk catatan pengawas — tidak memicu terminasi otomatis.
 useEffect(()=>{
  if(expired)return;
  const privacyInfo='Kamera depan memantau kehadiran wajah. Gambar hanya diproses di perangkat ini dan tidak dikirim ke server.';
  const modelNotice='Pemantauan wajah sedang terganggu di perangkat ini. Ujian tetap berjalan; hubungi pengawas bila gangguan berlanjut.';
  let infoTimer=0;
  const hideInfo=()=>{window.clearTimeout(infoTimer);infoTimer=0;setFaceNotice(notice=>notice===privacyInfo?'':notice);};
  const showInfoOnce=()=>{
   if(faceInfoShown.current)return;
   faceInfoShown.current=true;
   setFaceNotice(privacyInfo);
   infoTimer=window.setTimeout(hideInfo,8000);
  };
  // Reporter menangani retry bertahap, anti-request-paralel, dan latest-wins.
  // `starting`/`model-error` tidak dipetakan sehingga tidak pernah dikirim.
  const faceReporter=createFaceReporter({
   send:(status)=>api(`/api/student/exams/${attempt.exam.id}/face-presence`,{method:'PATCH',keepalive:true,body:{status}}),
   timer:{set:(callback,delay)=>window.setTimeout(callback,delay),clear:(handle)=>window.clearTimeout(handle)},
  });
  const reportFace=(status:FacePresenceStatus)=>faceReporter.report(status);
  const monitor=createFacePresence({
   initialStream:preflightResult?.cameraStream??null,
   onStatus:(status,detail)=>{
    setFaceStatus(status);
    if(status==='starting'){showInfoOnce();return;}
    hideInfo();
    if(status==='ok'){
     setFaceNotice('');
     reportFace('ok');
    } else if(status==='blocked')setFaceNotice('Izin kamera tidak diberikan. Pengawasan wajah tidak berjalan; hubungi pengawas bila kamera bermasalah.');
    else if(status==='unavailable')setFaceNotice('');
    else if(status==='model-error')setFaceNotice(modelNotice);
    else if(status==='error'&&detail?.reason==='ended')setFaceNotice('Kamera terputus. Arahkan kamera ke wajah atau hubungi pengawas.');
    else if(status==='error')setFaceNotice('Kamera pengawasan belum siap. Bila wajah tidak terpantau, muat ulang halaman atau hubungi pengawas.');
   },
   onAbsent:()=>{
    setFaceNotice('Wajah tidak terdeteksi. Hadapkan wajah ke kamera dan jangan meninggalkan perangkat. Sinyal ini tercatat untuk pengawas.');
    recordRef.current?.('FACE_ABSENT');
    reportFace('absent');
   },
   onRecovered:()=>{
    // Wajah kembali terdeteksi: hapus peringatan dan laporkan OK ke server.
    setFaceNotice('');
    reportFace('ok');
   },
   onMultipleFaces:({faces})=>{
    batcherRef.current?.push({
     event_key:makeEventKey('MULTIPLE_FACES'),
     event_type:'MULTIPLE_FACES',
     client_occurred_at:new Date().toISOString(),
     metadata:{faces},
    });
   },
   onCameraProblem:()=>{
    // Semua masalah kamera nyata (izin ditolak, tanpa kamera, browser tidak
    // mendukung, kamera terputus/error) dicatat satu episode FACE_CAMERA_OFF
    // dan dilaporkan CAMERA_OFF. Gangguan model TIDAK lewat jalur ini.
    recordRef.current?.('FACE_CAMERA_OFF');
    reportFace('error');
   },
  });
  void monitor.start();
  return ()=>{faceReporter.dispose();window.clearTimeout(infoTimer);monitor.stop();};
 },[attempt.attempt_id,expired]);
 // Perekaman video segmen 60 detik langsung ke Linode Object Storage (jika diaktifkan).
 useEffect(()=>{
  if(expired||!recordingEnabled||!preflightResult?.cameraStream||!preflightResult.recordingMimeType)return;
  let cancelled=false;
  let recorder:ReturnType<typeof createExamRecorder>|null=null;
  let queue:ReturnType<typeof createUploadQueue>|null=null;
  let sessionId='';
  const mimeType=preflightResult.recordingMimeType;
  const stream=preflightResult.cameraStream;
  void api<{session_id:string}>(`/api/student/exams/${attempt.exam.id}/recording/session`,{method:'POST',body:{}}).then(({session_id})=>{
   if(cancelled)return;
   sessionId=session_id;
   queue=createUploadQueue({
    sessionId,
    examId:attempt.exam.id,
    requestPresignedUrl:(seg)=>api<{upload_url:string;segment_id:number}>(`/api/student/exams/${attempt.exam.id}/recording/segment`,{
     method:'POST',
     body:{session_id:sessionId,sequence_number:seg.sequenceNumber,mime_type:seg.mimeType,segment_started_at:seg.startedAt},
    }),
    confirmUpload:(_seg,segmentId,fileSizeBytes)=>api(`/api/student/exams/${attempt.exam.id}/recording/segment/${segmentId}`,{
     method:'PATCH',
     body:{file_size_bytes:fileSizeBytes,segment_ended_at:new Date().toISOString()},
    }).then(()=>undefined),
    onPermanentFailure:(seg)=>{
     batcherRef.current?.push({
      event_key:makeEventKey('RECORDING_UPLOAD_FAILED'),
      event_type:'RECORDING_UPLOAD_FAILED',
      client_occurred_at:new Date().toISOString(),
      metadata:{sequence:seg.sequenceNumber},
     });
    },
    onStatusChange:(pending)=>setUploadPending(pending),
   });
   queue.start();
   recorder=createExamRecorder({
    stream,
    mimeType,
    videoBitsPerSecond:videoBitrate,
    segmentDurationMs:segmentDurationSeconds*1000,
    onSegment:(seg)=>{
     void queue?.enqueue({
      id:`${sessionId}_${seg.sequenceNumber}`,
      blob:seg.blob,
      mimeType:seg.mimeType,
      sequenceNumber:seg.sequenceNumber,
      sessionId,
      examId:attempt.exam.id,
      startedAt:seg.startedAt.toISOString(),
      endedAt:seg.endedAt.toISOString(),
     }).catch(()=>{/* queue full */});
    },
    onError:()=>{
     setRecordingActive(false);
     batcherRef.current?.push({event_key:makeEventKey('RECORDING_INTERRUPTED'),event_type:'RECORDING_INTERRUPTED',client_occurred_at:new Date().toISOString()});
    },
    onStopped:()=>{
     setRecordingActive(false);
    },
   });
   recorder.start();
   setRecordingActive(true);
   batcherRef.current?.push({event_key:makeEventKey('RECORDING_STARTED'),event_type:'RECORDING_STARTED',client_occurred_at:new Date().toISOString()});
  }).catch(()=>{/* recording initialization failed */});
  return()=>{
   cancelled=true;
   recorder?.stop();
   queue?.stop();
   setRecordingActive(false);
   if(sessionId){
    void api(`/api/student/exams/${attempt.exam.id}/recording/finalize`,{method:'POST',keepalive:true,body:{session_id:sessionId}}).catch(()=>{/* non-fatal */});
   }
  };
 },[attempt.attempt_id,attempt.exam.id,expired,recordingEnabled,preflightResult,segmentDurationSeconds,videoBitrate]);
 // Muat lebih awal gambar pada dua soal berikutnya supaya perpindahan soal
 // tidak menunggu unduhan, tanpa membebani jaringan saat ujian baru dimulai.
 const preloaded=useRef<HTMLImageElement[]>([]);
 useEffect(()=>{
  const urls=new Set<string>();
  const parser=new DOMParser();
  for(const item of attempt.soal.slice(current+1,current+3)){
   for(const html of [item.pertanyaan,...item.opsi.map(option=>option.text)]){
    const doc=parser.parseFromString(html??'','text/html');
    doc.querySelectorAll('img[src]').forEach(image=>{const src=image.getAttribute('src');if(src&&!src.startsWith('data:'))urls.add(src);});
   }
  }
  preloaded.current=[...urls].slice(0,8).map(src=>{const image=new Image();image.decoding='async';image.src=src;return image;});
  return ()=>{preloaded.current=[];};
 },[current,attempt.attempt_id]);
 // Traceable screenshot overlay: NCAA-inspectable CSS-only repeated name/NIS pattern.
 const watermark=useRef<string>('');
 if(!watermark.current&&studentNisn){
  const text=`${studentNisn} · ${studentName}`.slice(0,60);
  const svg=`<svg xmlns='http://www.w3.org/2000/svg' width='340' height='170'><text x='170' y='88' transform='rotate(-30 170 85)' fill='rgba(15,23,42,0.07)' font-size='13' font-family='sans-serif' text-anchor='middle'>${text.replace(/[<>&']/g,'')}</text></svg>`;
  watermark.current=`url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
 }
  const question=attempt.soal[current];const minutes=Math.floor(remaining/60),seconds=remaining%60;

 const answered=attempt.soal.filter(item=>Boolean(answers[item.id]?.trim())).length;
 const unanswered=attempt.soal.length-answered;
 const flagged=attempt.soal.filter(item=>flags[item.id]).length;
 const saveText=saveState==='error'?'Jawaban belum tersimpan':saveState==='saving'?'Menyimpan jawaban…':'Semua perubahan tersimpan';
 const hasNativeShell=Boolean((window as Window&{ArenaApp?:unknown}).ArenaApp);
 const requireFullscreenGuard=!fullscreenActive&&isFullscreenSupported()&&!hasNativeShell&&!helpOpen&&!expired&&saveState!=='error'&&!submitOpen;
 const retryExpiredResult=()=>{if(submitting.current)return;submitting.current=true;setExpiryFailed(false);void submit(true).catch(()=>{submitting.current=false;setExpiryFailed(true);});};
 const requestFinish=(event:React.MouseEvent<HTMLButtonElement>)=>{if(remaining===0)return;if(saveState==='error'){setWarning('Ada jawaban yang belum tersimpan. Periksa koneksi sebelum menyelesaikan ujian.');return;}submitTrigger.current=event.currentTarget;setSubmitOpen(true);};
 return <section className="cbt-wrapper student-exam notranslate" translate="no" lang="id">{watermark.current&&<div aria-hidden="true" className="student-exam-watermark" style={{backgroundImage:watermark.current}}/>}<header className="cbt-header"><div className="cbt-identity"><div className="id-item"><span className="id-label">Mata Pelajaran</span><span className="id-val">{attempt.exam.nama_ujian}</span></div><div className="id-item"><span className="id-label">Peserta</span><span className="id-val">{studentName}</span></div><div className="id-item"><span className="id-label">No. Ujian</span><span className="id-val">{attempt.exam.id}</span></div><div className="id-item"><span className="id-label">Status</span><span className="id-val">{answered} dari {attempt.soal.length} dijawab</span></div></div><div className={remaining>0&&remaining<=300?'timer-box danger':'timer-box'}><span className="id-label">SISA WAKTU</span><span className="timer-time" aria-live="off">{String(minutes).padStart(2,'0')}:{String(seconds).padStart(2,'0')}</span></div><div className="student-exam-header-actions">{(recordingActive||uploadPending>0)&&<span className="face-guard-chip face-ok" title="Status perekaman ujian"><i className="fa-solid fa-record-vinyl"/><span>{uploadPending>0?`Mengunggah (${uploadPending})`:'Merekam'}</span></span>}<span className={`face-guard-chip face-${faceStatus}`} title="Kamera hanya memproses wajah di perangkat ini; tidak ada foto atau video yang dikirim ke server."><i className={`fa-solid ${faceStatus==='ok'?'fa-face-smile':faceStatus==='absent'?'fa-face-frown':faceStatus==='blocked'?'fa-camera-slash':faceStatus==='unavailable'?'fa-video-slash':faceStatus==='model-error'?'fa-shield-halved':faceStatus==='error'?'fa-triangle-exclamation':'fa-camera'}`}/><span>{faceStatus==='ok'?'Wajah terpantau':faceStatus==='absent'?'Wajah tidak terlihat':faceStatus==='blocked'?'Kamera nonaktif':faceStatus==='unavailable'?'Tanpa kamera':faceStatus==='model-error'?'Pemantauan terganggu':faceStatus==='error'?'Kamera bermasalah':'Menyiapkan kamera'}</span></span><button className="cbt-help-button" type="button" onClick={onHelp}><i className="fa-solid fa-headset"/> Bantuan</button><button className="student-fullscreen-button" type="button" aria-label="Layar penuh" title="Layar penuh" onClick={()=>{fullscreenRequested.current=true;setExamMode(true);}}><i className="fa-solid fa-expand"/></button></div></header>
 <div className="student-exam-progress"><div><span>{answered} soal dijawab</span><span>{attempt.soal.length} soal</span></div><progress aria-label="Progres jawaban" max={attempt.soal.length||1} value={answered}/></div>{faceNotice&&<div className={`exam-face-warning ${faceStatus==='absent'?'is-absent':'is-info'}`} role="alert"><i className={`fa-solid ${faceStatus==='absent'?'fa-face-frown':faceStatus==='model-error'?'fa-triangle-exclamation':'fa-camera'}`}/><span>{faceNotice}</span></div>}{warning&&<p className="exam-warning" role="status">{warning}</p>}{message&&saveState!=='error'&&<p className="exam-warning" role="alert">{message}</p>}{remaining>0&&saveState==='error'&&<div className="exam-save-error" role="alert"><span>Jawaban belum tersimpan. {message||'Periksa koneksi sebelum menyelesaikan ujian.'}</span><button type="button" onClick={()=>void retrySave()}>Coba simpan lagi</button></div>}
 {remaining===0&&<div className="exam-expired-note" role="status"><span>Waktu ujian habis. Hasil dihitung dari jawaban yang sudah tersimpan.</span>{expiryFailed&&<button type="button" disabled={busy} onClick={retryExpiredResult}>Coba muat hasil lagi</button>}</div>}<button className="student-map-toggle btn btn-secondary" type="button" aria-expanded={mapOpen} aria-controls="student-question-map" onClick={()=>{if(!mapOpen)window.setTimeout(()=>document.getElementById('student-question-map')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}),0);setMapOpen(open=>!open);}}><i className="fa-solid fa-border-all"/> {mapOpen?'Tutup peta soal':'Peta soal ('+answered+'/'+attempt.soal.length+' dijawab)'}</button><div className="cbt-grid">{question&&<article className="q-panel"><div className="q-meta"><span className="q-num">Soal {current+1} dari {attempt.soal.length}</span><span role="status" aria-live="polite" className={`student-save-badge state-${saveState}`}><i className={`fa-solid ${saveState==='error'?'fa-triangle-exclamation':saveState==='saving'?'fa-arrows-rotate fa-spin':'fa-cloud-arrow-up'}`}/> {saveText}</span></div><ActiveQuestionMath key={question.id} question={question}><div className="q-text question-rich-content" dir="auto" dangerouslySetInnerHTML={{__html:question.pertanyaan}}/>{question.tipe==='SHORT_ANSWER'?<input className="short-answer" aria-label="Jawaban singkat" dir="auto" maxLength={500} value={answers[question.id]??''} disabled={busy} onChange={e=>change(question,e.target.value)}/>:<div className="opt-list">{question.opsi.map(option=><label className={`opt-btn ${(answers[question.id]??'').split(',').includes(option.key)?'selected':''}`} key={option.key}><input className="exam-option-input" type={question.tipe==='MULTIPLE_RESPONSE'?'checkbox':'radio'} name={`question-${question.id}`} checked={(answers[question.id]??'').split(',').includes(option.key)} disabled={busy} onChange={e=>{const selected=new Set((answers[question.id]??'').split(',').filter(Boolean));if(question.tipe==='MULTIPLE_RESPONSE')e.target.checked?selected.add(option.key):selected.delete(option.key);else{selected.clear();selected.add(option.key);}change(question,[...selected].sort().join(','));}}/><span className="opt-text" dir="auto" dangerouslySetInnerHTML={{__html:option.text}}/></label>)}</div>}</ActiveQuestionMath><div className="q-nav-actions"><button className="btn btn-secondary" disabled={busy||current===0} onClick={()=>setCurrent(current-1)}><i className="fa-solid fa-chevron-left"/> Sebelumnya</button><button className="btn btn-warning" type="button" disabled={busy} aria-pressed={flags[question.id]??false} onClick={()=>toggleFlag(question)}><i className="fa-solid fa-flag"/> {flags[question.id]?'Hapus ragu':'Ragu-ragu'}</button><button className="btn btn-primary" disabled={busy} onClick={current>=attempt.soal.length-1?requestFinish:()=>setCurrent(current+1)}>{current>=attempt.soal.length-1?'Selesai ujian':'Berikutnya'} <i className={`fa-solid ${current>=attempt.soal.length-1?'fa-paper-plane':'fa-chevron-right'}`}/></button></div></article>}
 <aside id="student-question-map" className={'nav-panel student-question-map '+(mapOpen?'is-open':'')}><div className="nav-panel-title"><b><i className="fa-solid fa-border-all"/> Peta soal</b><span>Pilih nomor soal</span></div><div className="student-map-legend"><span>Hijau: dijawab</span><span>Kuning: ragu</span></div><nav className="nav-grid" aria-label="Nomor soal">{attempt.soal.map((item,index)=><button type="button" key={item.id} className={`btn-num ${answers[item.id]?.trim()?'answered ':''}${flags[item.id]?'flagged ':''}${index===current?'active':''}`} aria-label={'Soal '+(index+1)+(answers[item.id]?.trim()?', dijawab':', belum dijawab')+(flags[item.id]?', ragu-ragu':'')} aria-current={index===current?'step':undefined} onClick={()=>{setCurrent(index);setMapOpen(false);window.setTimeout(()=>document.querySelector('.student-exam .q-panel')?.scrollIntoView({behavior:'auto',block:'start'}),0);}}>{index+1}</button>)}</nav><hr/><button className="btn btn-danger finish-exam" type="button" disabled={busy||remaining===0} onClick={requestFinish}><i className="fa-solid fa-paper-plane"/> SELESAI UJIAN</button></aside></div>{children}{requireFullscreenGuard&&<div className="modal show student-submit-backdrop" role="presentation"><div className="modal-content student-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="student-fullscreen-guard-title"><div className="student-submit-symbol"><i className="fa-solid fa-expand"/></div><h2 id="student-fullscreen-guard-title">Mode Layar Penuh Wajib Aktif</h2><p>Selama ujian berlangsung, layar penuh harus aktif. Keluar dari layar penuh dicatat dan dilaporkan ke pengawas.</p><p className="student-submit-note">Jika mengalami kendala jaringan atau sesi terkunci, buka menu Bantuan untuk mengirim tiket ke pengawas.</p><div className="student-submit-actions"><button className="btn btn-secondary" type="button" onClick={onHelp}><i className="fa-solid fa-headset"/> Bantuan Pengawas</button><button className="btn btn-primary" type="button" onClick={()=>{fullscreenRequested.current=true;setExamMode(true);enterFullscreenNow();}}><i className="fa-solid fa-expand"/> Aktifkan Layar Penuh</button></div></div></div>}{submitOpen&&<div className="modal show student-submit-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setSubmitOpen(false);}}><div className="modal-content student-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="student-submit-title"><div className="student-submit-symbol"><i className="fa-solid fa-circle-exclamation"/></div><h2 id="student-submit-title">Kumpulkan Ujian?</h2><p>{unanswered>0?`${unanswered} soal belum dijawab. Periksa kembali sebelum mengumpulkan.`:'Semua soal telah dijawab. Pastikan jawaban Anda sudah sesuai.'}</p><div className="student-submit-counts"><span><i className="fa-solid fa-check"/> {answered} dijawab</span><span><i className="fa-solid fa-circle-question"/> {unanswered} kosong</span><span><i className="fa-solid fa-flag"/> {flagged} ragu-ragu</span></div><p className="student-submit-note">Setelah dikumpulkan, jawaban tidak dapat diubah.</p><div className="student-submit-actions"><button ref={submitCancelButton} className="btn btn-secondary" type="button" disabled={busy} onClick={()=>setSubmitOpen(false)}>Periksa Lagi</button><button className="btn btn-primary" type="button" disabled={busy||saveState!=='saved'} onClick={()=>{submitting.current=true;void submit(false).catch(()=>{submitting.current=false;setSubmitOpen(false);});}}>Ya, Kumpulkan</button></div></div></div>}</section>;
}

export function StudentResult({examName,result,review,reviewLoading=false,reviewError='',onReview,onClose,onHelp}:{examName:string;result:ExamResult;review:{soal:{id:number;pertanyaan?:string;status:string}[]}|null;reviewLoading?:boolean;reviewError?:string;onReview:()=>Promise<void>;onClose:()=>void;onHelp:()=>void}){
 const [reviewOpen,setReviewOpen]=useState(false);
 const reviewButton=useRef<HTMLButtonElement>(null);
 const closeButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!reviewOpen)return;
  closeButton.current?.focus();
  const onKeyDown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){setReviewOpen(false);return;}
   if(event.key!=='Tab')return;
   const buttons=closeButton.current?.closest('.student-review-dialog')?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
   if(!buttons?.length)return;
   const first=buttons[0],last=buttons[buttons.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  document.addEventListener('keydown',onKeyDown);
  return()=>{document.removeEventListener('keydown',onKeyDown);reviewButton.current?.focus();};
 },[reviewOpen]);
 useEffect(()=>{if(reviewOpen&&review?.soal.length){const engine=(window as unknown as {MathJax?:{typesetPromise?:()=>Promise<void>}}).MathJax;void engine?.typesetPromise?.();}},[reviewOpen,review]);
 const status=String(result.status??'selesai').toUpperCase();
 const terminated=status==='TERMINATED';
 const expired=status==='EXPIRED';
 const statusLabel=terminated?'Sesi dihentikan':expired?'Waktu habis':'Ujian selesai';
 const statusDescription=terminated?'Sesi ujian dihentikan. Hubungi petugas jika Anda memerlukan bantuan.':expired?'Waktu ujian telah habis. Hasil dihitung dari jawaban yang tersimpan.':'Jawaban Anda sudah dikirim dan hasil telah diproses.';
 const score=result.nilai==null?null:Number(result.nilai);
 const hasScore=score!==null&&Number.isFinite(score);
 const hasCounts=result.benar!=null&&result.salah!=null&&result.kosong!=null;
 const statusText:Record<string,string>={BENAR:'Benar',SALAH:'Salah',KOSONG:'Kosong',SEBAGIAN:'Sebagian benar'};
 return <div className="student-result-page"><section className="student-result" aria-labelledby="student-result-title">
  <div className="student-result-head"><div className={`student-result-symbol ${terminated?'is-terminated':expired?'is-expired':''}`} aria-hidden="true"><i className={`fa-solid ${terminated?'fa-circle-exclamation':expired?'fa-clock':'fa-circle-check'}`}/></div><span className={`student-result-status ${terminated?'is-terminated':expired?'is-expired':''}`}>{statusLabel}</span></div>
  <h1 id="student-result-title">Hasil ujian</h1>
  {examName&&<p className="student-result-exam">{examName}</p>}
  <p className="student-result-description">{statusDescription}</p>
  {hasScore?<div className="student-result-score"><span>NILAI AKHIR</span><strong>{new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(score)}</strong><small>dari 100</small></div>:<p className="student-result-pending" role="status">Nilai belum tersedia. Periksa kembali beberapa saat lagi.</p>}
  {hasCounts&&<div className="student-result-counts" aria-label="Ringkasan jawaban"><div><strong>{result.benar}</strong><span>Benar</span></div><div><strong>{result.salah}</strong><span>Belum benar</span></div><div><strong>{result.kosong}</strong><span>Kosong</span></div></div>}
  {(result.is_remedial||result.follow_up_type==='REMEDIAL')&&<p className="student-result-remedial"><i className="fa-solid fa-circle-info"/> Nilai remedial mengikuti batas maksimum yang berlaku{result.score_cap!=null?`: ${result.score_cap}`:''}.</p>}
  {terminated?<><p className="student-result-review-note">Review tidak tersedia untuk sesi yang dihentikan.</p><button className="btn btn-danger student-result-review-button" type="button" onClick={onHelp}><i className="fa-solid fa-headset"/> Minta bantuan petugas</button></>:<button ref={reviewButton} className="btn btn-secondary student-result-review-button" type="button" onClick={()=>{setReviewOpen(true);if(!review&&!reviewLoading&&!reviewError)void onReview();}}><i className="fa-solid fa-list-check"/> Review Status (Benar/Salah) <i className="fa-solid fa-arrow-right"/></button>}
  <button className="btn btn-primary student-result-back" type="button" onClick={onClose}><i className="fa-solid fa-arrow-left"/> Kembali ke daftar ujian</button>
 </section>{reviewOpen&&<div className="student-review-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setReviewOpen(false);}}><div className="student-review-dialog" role="dialog" aria-modal="true" aria-labelledby="student-review-title"><div className="student-review-header"><div><span>HASIL UJIAN</span><h2 id="student-review-title">Review Status Jawaban</h2></div><button ref={closeButton} type="button" aria-label="Tutup review" onClick={()=>setReviewOpen(false)}>&times;</button></div><div className="student-review-body"><p className="student-result-review-note">Status setiap soal ditampilkan tanpa kunci jawaban.</p>{reviewLoading?<p className="student-review-state" role="status">Memuat review soal…</p>:reviewError?<div className="student-review-error" role="alert">Review belum dapat ditampilkan. {reviewError}</div>:review?.soal.length?<ol className="student-result-review-list">{review.soal.map((item,index)=><li key={item.id}><div className="student-result-review-title"><strong>Soal {index+1}</strong><span className={`student-result-answer-status status-${item.status.toLowerCase()}`}>{statusText[item.status]??item.status}</span></div>{item.pertanyaan&&<div className="student-result-question question-rich-content" dir="auto" dangerouslySetInnerHTML={{__html:item.pertanyaan}}/>}</li>)}</ol>:<p className="student-review-state" role="status">Menyiapkan review soal…</p>}</div><div className="student-review-footer"><button className="btn btn-primary" type="button" onClick={()=>setReviewOpen(false)}>Tutup</button></div></div></div>}</div>;
}

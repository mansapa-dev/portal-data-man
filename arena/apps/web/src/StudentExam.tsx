import React, { useEffect, useRef, useState } from 'react';
import { api, mutationId } from './lib/api';

export type ExamQuestion={id:number;tipe:string;pertanyaan:string;opsi:{key:string;text:string}[];poin:number};
export type ExamAttempt={attempt_id:string;exam:{id:number;nama_ujian:string};expires_at:string;server_time?:string;soal:ExamQuestion[];jawaban:{question_id:number;answer:string|null;is_flagged:boolean;revision:number}[]};
export type ExamResult={status?:string;nilai?:number|string|null;benar?:number|null;salah?:number|null;kosong?:number|null;jumlah_soal?:number|null;is_remedial?:boolean;score_cap?:number|null;follow_up_type?:string|null};

export function StudentExam({attempt,studentName,answers,flags,busy,saveState='saved',message,change,toggleFlag,retrySave,submit,onTerminated,onHelp,children}:{attempt:ExamAttempt;studentName:string;answers:Record<number,string>;flags:Record<number,boolean>;busy:boolean;saveState?:'saved'|'saving'|'error';message?:string;change:(question:ExamQuestion,value:string)=>void;toggleFlag:(question:ExamQuestion)=>void;retrySave:()=>Promise<void>;submit:(finalizeOnly?:boolean)=>Promise<void>;onTerminated:(result:ExamResult|null)=>void;onHelp:()=>void;children?:React.ReactNode}){
 const [remaining,setRemaining]=useState(()=>Math.max(0,Math.ceil((Date.parse(attempt.expires_at)-Date.now()-(attempt.server_time?Date.parse(attempt.server_time)-Date.now():0))/1000))),[warning,setWarning]=useState(''),[current,setCurrent]=useState(0),[submitOpen,setSubmitOpen]=useState(false),[expiryFailed,setExpiryFailed]=useState(false),[mapOpen,setMapOpen]=useState(false);const lastEvent=useRef<Record<string,number>>({}),submitting=useRef(false),fullscreenRequested=useRef(false),submitRef=useRef(submit),terminationRef=useRef(onTerminated);
 const submitCancelButton=useRef<HTMLButtonElement>(null),submitTrigger=useRef<HTMLButtonElement|null>(null);
 submitRef.current=submit;
 terminationRef.current=onTerminated;
 useEffect(()=>{if(!submitOpen)return;submitCancelButton.current?.focus();const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy)setSubmitOpen(false);if(event.key==='Tab'){const buttons=submitCancelButton.current?.closest('.student-submit-dialog')?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');if(!buttons?.length)return;const first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};document.addEventListener('keydown',onKeyDown);return()=>{document.removeEventListener('keydown',onKeyDown);submitTrigger.current?.focus();};},[submitOpen,busy]);
 const offset=useRef(attempt.server_time?Date.parse(attempt.server_time)-Date.now():0);
 useEffect(()=>{offset.current=attempt.server_time?Date.parse(attempt.server_time)-Date.now():0;submitting.current=false;setExpiryFailed(false);let expiryStarted=false;const tick=()=>{const seconds=Math.max(0,Math.ceil((Date.parse(attempt.expires_at)-Date.now()-offset.current)/1000));setRemaining(seconds);if(seconds===0&&!expiryStarted&&!submitting.current){expiryStarted=true;submitting.current=true;setSubmitOpen(false);void submitRef.current(true).catch(()=>{submitting.current=false;setExpiryFailed(true);setWarning('Waktu habis. Hasil dihitung dari jawaban yang berhasil tersimpan.');});}};tick();const timer=window.setInterval(tick,1000);return()=>clearInterval(timer);},[attempt.attempt_id]);
 useEffect(()=>{
  let active=true,constrained=false,viewportTimer=0;
  const record=(type:'TAB_HIDDEN'|'FULLSCREEN_EXIT'|'SCREENSHOT_ATTEMPT'|'COPY_ATTEMPT'|'PASTE_ATTEMPT'|'CUT_ATTEMPT'|'CONTEXT_MENU_ATTEMPT'|'DEVTOOLS_SHORTCUT'|'BROWSER_SHORTCUT'|'SPLIT_SCREEN_SUSPECTED')=>{
   if(submitting.current)return;
   const now=Date.now();if(now-(lastEvent.current[type]??0)<5000)return;lastEvent.current[type]=now;
   void api<{count:number;terminated:boolean;hasil?:ExamResult}>(`/api/student/exams/${attempt.exam.id}/violations`,{method:'POST',body:{event_key:mutationId(),type,client_occurred_at:new Date().toISOString()}}).then(result=>{
    if(!active)return;
    if(result.terminated){submitting.current=true;terminationRef.current({...result.hasil,status:'TERMINATED'});}
    else if(['PASTE_ATTEMPT','CUT_ATTEMPT','CONTEXT_MENU_ATTEMPT','DEVTOOLS_SHORTCUT','BROWSER_SHORTCUT','SPLIT_SCREEN_SUSPECTED'].includes(type))setWarning(`Sinyal dicatat untuk ditinjau pengawas; hitungan pelanggaran otomatis tetap ${result.count}/3.`);
    else setWarning(`Pelanggaran tercatat (${result.count}/3). Tetap di halaman ujian dan ikuti arahan pengawas.`);
   }).catch(error=>{if(active)setWarning(`Sinyal belum tercatat: ${(error as Error).message}`);});
  };
  const visibility=()=>{if(document.hidden)record('TAB_HIDDEN');};
  const clipboard=(type:'COPY_ATTEMPT'|'PASTE_ATTEMPT'|'CUT_ATTEMPT')=>(event:ClipboardEvent)=>{event.preventDefault();record(type);};
  const contextMenu=(event:MouseEvent)=>{event.preventDefault();record('CONTEXT_MENU_ATTEMPT');};
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
  const fullscreen=()=>{if(fullscreenRequested.current&&!document.fullscreenElement)record('FULLSCREEN_EXIT');};
  const viewport=()=>{
   window.clearTimeout(viewportTimer);
   viewportTimer=window.setTimeout(()=>{
    const focused=typeof document.hasFocus!=='function'||document.hasFocus();
    const editable=document.activeElement?.matches('input,textarea,select,[contenteditable="true"]');
    const scale=window.visualViewport?.scale??1;
    if(document.hidden||!focused||navigator.maxTouchPoints<1||editable||Math.abs(scale-1)>0.05||Math.min(screen.width,screen.height)>600||!screen.width||!screen.height){constrained=false;return;}
    const next=window.innerWidth/screen.width<0.72||window.innerHeight/screen.height<0.58;
    if(next&&!constrained)record('SPLIT_SCREEN_SUSPECTED');constrained=next;
   },1500);
  };
  const orientation=()=>{constrained=false;window.clearTimeout(viewportTimer);viewportTimer=window.setTimeout(viewport,1800);};
  document.addEventListener('visibilitychange',visibility);document.addEventListener('copy',copy,true);document.addEventListener('paste',paste,true);document.addEventListener('cut',cut,true);document.addEventListener('contextmenu',contextMenu,true);document.addEventListener('keydown',keydown,true);document.addEventListener('fullscreenchange',fullscreen);window.addEventListener('resize',viewport);window.addEventListener('orientationchange',orientation);viewport();
  return()=>{active=false;document.removeEventListener('visibilitychange',visibility);document.removeEventListener('copy',copy,true);document.removeEventListener('paste',paste,true);document.removeEventListener('cut',cut,true);document.removeEventListener('contextmenu',contextMenu,true);document.removeEventListener('keydown',keydown,true);document.removeEventListener('fullscreenchange',fullscreen);window.removeEventListener('resize',viewport);window.removeEventListener('orientationchange',orientation);window.clearTimeout(viewportTimer);};
 },[attempt.attempt_id]);
  const question=attempt.soal[current];const minutes=Math.floor(remaining/60),seconds=remaining%60;
  useEffect(()=>{const engine=(window as unknown as {MathJax?:{typesetPromise?:()=>Promise<void>}}).MathJax;void engine?.typesetPromise?.();},[question?.id]);
 const answered=attempt.soal.filter(item=>Boolean(answers[item.id]?.trim())).length;
 const unanswered=attempt.soal.length-answered;
 const flagged=attempt.soal.filter(item=>flags[item.id]).length;
 const saveText=saveState==='error'?'Jawaban belum tersimpan':saveState==='saving'?'Menyimpan jawaban…':'Semua perubahan tersimpan';
 const retryExpiredResult=()=>{if(submitting.current)return;submitting.current=true;setExpiryFailed(false);void submit(true).catch(()=>{submitting.current=false;setExpiryFailed(true);});};
 const requestFinish=(event:React.MouseEvent<HTMLButtonElement>)=>{if(remaining===0)return;if(saveState==='error'){setWarning('Ada jawaban yang belum tersimpan. Periksa koneksi sebelum menyelesaikan ujian.');return;}submitTrigger.current=event.currentTarget;setSubmitOpen(true);};
 return <section className="cbt-wrapper student-exam"><header className="cbt-header"><div className="cbt-identity"><div className="id-item"><span className="id-label">Mata Pelajaran</span><span className="id-val">{attempt.exam.nama_ujian}</span></div><div className="id-item"><span className="id-label">Peserta</span><span className="id-val">{studentName}</span></div><div className="id-item"><span className="id-label">No. Ujian</span><span className="id-val">{attempt.exam.id}</span></div><div className="id-item"><span className="id-label">Status</span><span className="id-val">{answered} dari {attempt.soal.length} dijawab</span></div></div><div className={remaining>0&&remaining<=300?'timer-box danger':'timer-box'}><span className="id-label">SISA WAKTU</span><span className="timer-time" aria-live="off">{String(minutes).padStart(2,'0')}:{String(seconds).padStart(2,'0')}</span></div><div className="student-exam-header-actions"><button className="cbt-help-button" type="button" onClick={onHelp}><i className="fa-solid fa-headset"/> Bantuan</button><button className="student-fullscreen-button" type="button" aria-label="Layar penuh" title="Layar penuh" onClick={()=>{if(!document.documentElement.requestFullscreen){setWarning('Mode layar penuh tidak tersedia pada perangkat ini.');return;}fullscreenRequested.current=true;void document.documentElement.requestFullscreen().catch(()=>{fullscreenRequested.current=false;setWarning('Mode layar penuh tidak tersedia pada perangkat ini.');});}}><i className="fa-solid fa-expand"/></button></div></header>
 <div className="student-exam-progress"><div><span>{answered} soal dijawab</span><span>{attempt.soal.length} soal</span></div><progress aria-label="Progres jawaban" max={attempt.soal.length||1} value={answered}/></div>{warning&&<p className="exam-warning" role="status">{warning}</p>}{message&&saveState!=='error'&&<p className="exam-warning" role="alert">{message}</p>}{remaining>0&&saveState==='error'&&<div className="exam-save-error" role="alert"><span>Jawaban belum tersimpan. {message||'Periksa koneksi sebelum menyelesaikan ujian.'}</span><button type="button" onClick={()=>void retrySave()}>Coba simpan lagi</button></div>}
 {remaining===0&&<div className="exam-expired-note" role="status"><span>Waktu ujian habis. Hasil dihitung dari jawaban yang sudah tersimpan.</span>{expiryFailed&&<button type="button" disabled={busy} onClick={retryExpiredResult}>Coba muat hasil lagi</button>}</div>}<button className="student-map-toggle btn btn-secondary" type="button" aria-expanded={mapOpen} aria-controls="student-question-map" onClick={()=>{if(!mapOpen)window.setTimeout(()=>document.getElementById('student-question-map')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}),0);setMapOpen(open=>!open);}}><i className="fa-solid fa-border-all"/> {mapOpen?'Tutup peta soal':'Peta soal ('+answered+'/'+attempt.soal.length+' dijawab)'}</button><div className="cbt-grid">{question&&<article className="q-panel"><div className="q-meta"><span className="q-num">Soal {current+1} dari {attempt.soal.length}</span><span role="status" aria-live="polite" className={`student-save-badge state-${saveState}`}><i className={`fa-solid ${saveState==='error'?'fa-triangle-exclamation':saveState==='saving'?'fa-arrows-rotate fa-spin':'fa-cloud-arrow-up'}`}/> {saveText}</span></div><div className="q-text question-rich-content" dir="auto" dangerouslySetInnerHTML={{__html:question.pertanyaan}}/>{question.tipe==='SHORT_ANSWER'?<input className="short-answer" aria-label="Jawaban singkat" dir="auto" maxLength={500} value={answers[question.id]??''} disabled={busy} onChange={e=>change(question,e.target.value)}/>:<div className="opt-list">{question.opsi.map(option=><label className={`opt-btn ${(answers[question.id]??'').split(',').includes(option.key)?'selected':''}`} key={option.key}><input className="exam-option-input" type={question.tipe==='MULTIPLE_RESPONSE'?'checkbox':'radio'} name={`question-${question.id}`} checked={(answers[question.id]??'').split(',').includes(option.key)} disabled={busy} onChange={e=>{const selected=new Set((answers[question.id]??'').split(',').filter(Boolean));if(question.tipe==='MULTIPLE_RESPONSE')e.target.checked?selected.add(option.key):selected.delete(option.key);else{selected.clear();selected.add(option.key);}change(question,[...selected].sort().join(','));}}/><b className="opt-char" dir="ltr">{option.key}</b><span className="opt-text" dir="auto" dangerouslySetInnerHTML={{__html:option.text}}/></label>)}</div>}<div className="q-nav-actions"><button className="btn btn-secondary" disabled={busy||current===0} onClick={()=>setCurrent(current-1)}><i className="fa-solid fa-chevron-left"/> Sebelumnya</button><button className="btn btn-warning" type="button" disabled={busy} aria-pressed={flags[question.id]??false} onClick={()=>toggleFlag(question)}><i className="fa-solid fa-flag"/> {flags[question.id]?'Hapus ragu':'Ragu-ragu'}</button><button className="btn btn-primary" disabled={busy} onClick={current>=attempt.soal.length-1?requestFinish:()=>setCurrent(current+1)}>{current>=attempt.soal.length-1?'Selesai ujian':'Berikutnya'} <i className={`fa-solid ${current>=attempt.soal.length-1?'fa-paper-plane':'fa-chevron-right'}`}/></button></div></article>}
 <aside id="student-question-map" className={'nav-panel student-question-map '+(mapOpen?'is-open':'')}><div className="nav-panel-title"><b><i className="fa-solid fa-border-all"/> Peta soal</b><span>Pilih nomor soal</span></div><div className="student-map-legend"><span>Hijau: dijawab</span><span>Kuning: ragu</span></div><nav className="nav-grid" aria-label="Nomor soal">{attempt.soal.map((item,index)=><button type="button" key={item.id} className={`btn-num ${answers[item.id]?.trim()?'answered ':''}${flags[item.id]?'flagged ':''}${index===current?'active':''}`} aria-label={'Soal '+(index+1)+(answers[item.id]?.trim()?', dijawab':', belum dijawab')+(flags[item.id]?', ragu-ragu':'')} aria-current={index===current?'step':undefined} onClick={()=>{setCurrent(index);setMapOpen(false);window.setTimeout(()=>document.querySelector('.student-exam .q-panel')?.scrollIntoView({behavior:'auto',block:'start'}),0);}}>{index+1}</button>)}</nav><hr/><button className="btn btn-danger finish-exam" type="button" disabled={busy||remaining===0} onClick={requestFinish}><i className="fa-solid fa-paper-plane"/> SELESAI UJIAN</button></aside></div>{children}{submitOpen&&<div className="modal show student-submit-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setSubmitOpen(false);}}><div className="modal-content student-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="student-submit-title"><div className="student-submit-symbol"><i className="fa-solid fa-circle-exclamation"/></div><h2 id="student-submit-title">Kumpulkan Ujian?</h2><p>{unanswered>0?`${unanswered} soal belum dijawab. Periksa kembali sebelum mengumpulkan.`:'Semua soal telah dijawab. Pastikan jawaban Anda sudah sesuai.'}</p><div className="student-submit-counts"><span><i className="fa-solid fa-check"/> {answered} dijawab</span><span><i className="fa-solid fa-circle-question"/> {unanswered} kosong</span><span><i className="fa-solid fa-flag"/> {flagged} ragu-ragu</span></div><p className="student-submit-note">Setelah dikumpulkan, jawaban tidak dapat diubah.</p><div className="student-submit-actions"><button ref={submitCancelButton} className="btn btn-secondary" type="button" disabled={busy} onClick={()=>setSubmitOpen(false)}>Periksa Lagi</button><button className="btn btn-primary" type="button" disabled={busy||saveState!=='saved'} onClick={()=>{submitting.current=true;void submit(false).catch(()=>{submitting.current=false;setSubmitOpen(false);});}}>Ya, Kumpulkan</button></div></div></div>}</section>;
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

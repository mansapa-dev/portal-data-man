// Participant UI only. Exam permissions, server timing and answer persistence remain in their existing modules.
let studentExamFilter = 'all';
function studentScreenChanged(id) {
  const screen = document.getElementById(id)?.dataset.studentScreen;
  if (screen) document.body.dataset.studentScreen = screen;
  else delete document.body.dataset.studentScreen;
  if (screen === 'login') studentExamFilter = 'all';
}
document.addEventListener('DOMContentLoaded', () => {
  const screen = document.querySelector('[data-student-screen]:not(.hidden)');
  if (screen) studentScreenChanged(screen.id);
});
function studentHomeSection(section) {
  document.querySelectorAll('[data-student-page]').forEach(button => {
    if (button.dataset.studentPage === section) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const target = document.getElementById(section === 'exams' ? 'studentScheduleTitle' : 'studentWelcome');
  target?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',block:'start'});
}
function studentFilterExams(filter) {
  studentExamFilter = filter === 'done' ? 'done' : 'all';
  renderStudentExamCards(cacheStudentJadwal);
}
function renderStudentExamCards(rows) {
  const list = document.getElementById('listJadwalUjian');
  if (!list) return;
  const exams = Array.isArray(rows) ? rows : [];
  const done = exams.filter(exam => exam.status_pengerjaan === 'selesai');
  const ready = exams.filter(exam => exam.can_start && !['selesai','terblokir'].includes(exam.status_pengerjaan));
  [['studentExamCount',exams.length],['studentReadyCount',ready.length],['studentDoneCount',done.length]].forEach(([id,value]) => {
    const element = document.getElementById(id); if (element) element.textContent = value;
  });
  document.querySelectorAll('[data-student-filter]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.studentFilter === studentExamFilter)));
  const visible = studentExamFilter === 'done' ? done : exams;
  list.replaceChildren();
  const make = (tag,cls,text) => { const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el; };
  if (!visible.length) {
    const empty=make('div','student-exam-empty');
    empty.append(make('i','fa-regular fa-calendar-check'),make('strong','',studentExamFilter==='done'?'Belum ada ujian selesai':'Belum ada jadwal ujian'),make('p','',studentExamFilter==='done'?'Ujian yang sudah dikumpulkan akan muncul di sini.':'Jadwal akan muncul setelah tersedia untuk kelas dan sesi Anda.'));
    list.append(empty);return;
  }
  const inactive={NOT_SCHEDULED:'Tidak dijadwalkan',UPCOMING:'Belum dimulai',ENDED:'Jadwal berakhir',INACTIVE:'Tidak aktif',NOT_ELIGIBLE:'Tidak tersedia',EXPIRED:'Waktu habis'};
  visible.forEach(exam => {
    const completed=exam.status_pengerjaan==='selesai', blocked=exam.status_pengerjaan==='terblokir', ongoing=exam.status_pengerjaan==='berlangsung';
    const card=make('article','student-exam-card');
    const icon=make('div','student-exam-icon');icon.append(make('i',completed?'fa-solid fa-check':'fa-solid fa-book-open'));icon.setAttribute('aria-hidden','true');
    const info=make('div','student-exam-info');
    const status=make('span','student-exam-status'+(blocked?' is-blocked':''),completed?'Selesai':blocked?'Perlu bantuan':ongoing&&exam.can_start?'Sedang dikerjakan':exam.can_start?'Siap dikerjakan':inactive[exam.availability_reason]||'Tidak tersedia');
    info.append(status,make('h4','',exam.nama_ujian || 'Ujian'),make('p','',(exam.tanggal_ujian || 'Tanggal belum ditetapkan')+' · Sesi '+(exam.sesi || 1)+' · '+(exam.durasi_menit || 0)+' menit'));
    if(exam.is_special)info.append(make('span','student-special',exam.special_type==='REMEDIAL'?'Ujian ulang':'Ujian susulan'));
    const action=make('button','btn '+(blocked?'btn-danger':completed||!exam.can_start?'btn-secondary':'btn-primary'),completed?'Sudah dikerjakan':blocked?'Minta bantuan':exam.can_start?(ongoing?'Lanjutkan':'Mulai ujian'):inactive[exam.availability_reason]||'Tidak tersedia');
    action.type='button';
    if(blocked)action.addEventListener('click',()=>openSupportTicket('EXAM_LOCKED',exam.id));
    else if(!completed && exam.can_start)action.addEventListener('click',()=>persiapkanUjianById(exam.id));
    else action.disabled=true;
    card.append(icon,info,action);list.append(card);
  });
}
function updateStudentExamProgress() {
  const total=stSoal.length, answered=stSoal.filter(question=>!!stJawab[question.id]).length;
  const progress=document.getElementById('studentAnswerProgress');
  if(progress){progress.max=Math.max(1,total);progress.value=answered;progress.setAttribute('aria-valuetext',answered+' dari '+total+' soal dijawab');}
  const count=document.getElementById('studentAnswerCount');if(count)count.textContent=answered+' soal dijawab';
  const questions=document.getElementById('studentQuestionCount');if(questions)questions.textContent=total+' soal';
  const previous=document.getElementById('studentPreviousQuestion'),next=document.getElementById('studentNextQuestion');
  if(previous)previous.disabled=stIdx===0;
  if(next)next.disabled=stIdx>=total-1;
  document.getElementById('btnRagu')?.setAttribute('aria-pressed',String(!!stRagu[stSoal[stIdx]?.id]));
}
function updateStudentScoreRing(raw,terminated=false) {
  const value=Number(raw), valid=raw!==null && raw!==undefined && raw!=='' && Number.isFinite(value);
  const arc=document.getElementById('studentScoreArc');
  if(arc)arc.setAttribute('stroke-dasharray',valid?Math.min(100,Math.max(0,value))+' 100':'0 100');
  const ring=document.getElementById('studentScoreRing');if(ring)ring.classList.toggle('is-terminated',terminated);
  const label=document.getElementById('lblNilaiAkhir');if(label&&!valid)label.textContent='—';
}

function studentOptionKey(event, option) {
  const choices=Array.from(document.querySelectorAll('#cbtOptionList .opt-btn'));
  let target=option;
  if(['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(event.key)) {
    const direction=['ArrowDown','ArrowRight'].includes(event.key)?1:-1;
    target=choices[(choices.indexOf(option)+direction+choices.length)%choices.length];
  } else if(!['Enter',' '].includes(event.key)) return;
  event.preventDefault();target?.click();
  document.querySelector('#cbtOptionList [aria-checked="true"]')?.focus({preventScroll:true});
}

(function () {
  'use strict';
  let pollTimer = null, clockTimer = null, generation = 0, lastPayload = null, fetchedAt = 0;
  const PAGE_SIZE = 40, catalogState = new Map();
  const filterState = { exam: 'ALL', grade: 'ALL', className: 'ALL', subject: 'ALL', status: 'ALL', connection: 'ALL' };
  const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (className) node.className = className; return node; };
  const duration = seconds => { const safe = Math.max(0, Number(seconds) || 0), hours = Math.floor(safe / 3600), minutes = Math.floor((safe % 3600) / 60), secs = Math.floor(safe % 60); return hours > 0 ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`; };
  const statusLabel = status => ({ IN_PROGRESS: 'Mengerjakan', TERMINATED: 'Dihentikan', EXPIRED: 'Waktu habis' }[status] || status);
  const scoreLabel = value => Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });

  function stop() { generation += 1; clearTimeout(pollTimer); clearInterval(clockTimer); pollTimer = null; clockTimer = null; }
  function metric(label, value, tone = '') { const card = element('article', undefined, `live-metric ${tone}`.trim()); card.append(element('strong', value), element('span', label)); return card; }
  function sessionCard(session) {
    const card = element('article', undefined, 'session-card'), head = element('header'), identity = element('div');
    identity.append(element('strong', session.studentName), element('span', `${session.nisn} · ${session.className || '-'}`));
    head.append(identity, element('span', statusLabel(session.status), `session-status status-${session.status.toLowerCase()}`));
    const progressHead = element('div', undefined, 'progress-copy'), progress = element('div', undefined, 'progress-track'), fill = element('span');
    progressHead.append(element('span', `${session.answeredQuestions}/${session.totalQuestions} soal · progres ${session.progressPercent}%`), element('strong', `Nilai sementara ${scoreLabel(session.liveScore)}`));
    fill.style.width = `${Math.min(100, Math.max(0, session.progressPercent))}%`; progress.append(fill);
    const meta = element('div', undefined, 'session-meta'), remaining = element('strong', duration(session.remainingSeconds), 'remaining-time');
    remaining.dataset.remaining = String(session.remainingSeconds);
    const time = element('span', '⏱ Sisa '); time.append(remaining);
    meta.append(element('span', session.connectionState === 'ONLINE' ? 'Terhubung' : 'Koneksi belum terpantau'));
    meta.append(time, element('span', `⚑ Ragu ${session.flaggedQuestions}`), element('span', `⚠ Pelanggaran ${session.violationCount}`));
    card.append(head, element('p', `${session.subjectName ? session.subjectName + ' · ' : ''}${session.examName}`, 'session-exam'), progressHead, progress, meta); return card;
  }
  function filteredPayload(payload) {
    const sessions = payload.sessions.filter(s => (filterState.exam === 'ALL' || String(s.examId) === filterState.exam) && (filterState.grade === 'ALL' || String(s.gradeName) === filterState.grade) && (filterState.className === 'ALL' || String(s.className) === filterState.className) && (filterState.subject === 'ALL' || String(s.subjectName) === filterState.subject) && (filterState.status === 'ALL' || String(s.status) === filterState.status) && (filterState.connection === 'ALL' || String(s.connectionState) === filterState.connection));
    return {...payload,sessions,summary:{active:sessions.filter(s=>s.status==='IN_PROGRESS').length,total:sessions.length,online:sessions.filter(s=>s.connectionState==='ONLINE'&&s.status==='IN_PROGRESS').length,terminated:sessions.filter(s=>s.status==='TERMINATED').length}};
  }
  function filterBar(payload, refreshView, fields = null, staticOptions = {}) {
    const bar=element('div',undefined,'live-filters');
    const definitions=[['exam','Ujian / Sesi','Semua Ujian','examId'],['grade','Tingkatan','Semua Tingkatan','gradeName'],['className','Kelas','Semua Kelas','className'],['subject','Mata Pelajaran','Semua Mata Pelajaran','subjectName'],['status','Status','Semua Status','status'],['connection','Koneksi','Semua Koneksi','connectionState']].filter(([state])=>!fields||fields.includes(state));
    definitions.forEach(([state,label,all,key])=>{const field=element('label'),caption=element('span',label),select=element('select'),choices=new Map();(staticOptions[state]||[]).forEach(raw=>{const value=String(raw||'').trim();if(value)choices.set(value,state==='grade'?`Tingkat ${value}`:value);});payload.sessions.forEach(s=>{const value=String(s[key]||'').trim();if(value)choices.set(value,state==='exam'?s.examName:state==='grade'?`Tingkat ${value}`:statusLabel(value));});const values=[...choices.keys()].sort((a,b)=>String(choices.get(a)).localeCompare(String(choices.get(b)),'id',{numeric:true}));select.append(new Option(all,'ALL'),...values.map(value=>new Option(choices.get(value),value)));select.value=values.includes(filterState[state])?filterState[state]:'ALL';filterState[state]=select.value;select.addEventListener('change',()=>{filterState[state]=select.value;refreshView();});field.append(caption,select);bar.append(field);});return bar;
  }
  function appendSessions(root, sessions, grouped, rerender) {
    if (!grouped) { const grid=element('section',undefined,'session-grid');sessions.slice(0,PAGE_SIZE).forEach(session=>grid.append(sessionCard(session)));root.append(grid);return; }
    const groups=new Map();sessions.forEach(session=>{const key=String(session.examId);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(session);});
    groups.forEach((rows,key)=>{
      const state=catalogState.get(key)||{open:filterState.exam!=='ALL',page:1};catalogState.set(key,state);
      const section=element('section',undefined,`live-session-group${state.open?' is-open':''}`),head=element('header'),title=element('div');
      const online=rows.filter(s=>s.connectionState==='ONLINE'&&s.status==='IN_PROGRESS').length,average=rows.reduce((sum,s)=>sum+Number(s.liveScore||0),0)/rows.length;
      title.append(element('h3',rows[0].examName),element('p',`${rows[0].subjectName} · ${rows.length} peserta · ${online} online · rata-rata sementara ${scoreLabel(average)}`));
      const toggle=element('button',state.open?'Tutup peserta':'Lihat peserta','catalog-toggle');toggle.type='button';toggle.setAttribute('aria-expanded',String(state.open));toggle.addEventListener('click',()=>{state.open=!state.open;state.page=1;rerender();});
      head.append(title,toggle);section.append(head);
      if(state.open){
        const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));state.page=Math.min(state.page,pages);const start=(state.page-1)*PAGE_SIZE;
        const grid=element('div',undefined,'session-grid');rows.slice(start,start+PAGE_SIZE).forEach(session=>grid.append(sessionCard(session)));section.append(grid);
        if(pages>1){const pager=element('nav',undefined,'catalog-pager'),copy=element('span',`Menampilkan ${start+1}–${Math.min(start+PAGE_SIZE,rows.length)} dari ${rows.length}`),controls=element('div');const prev=element('button','Sebelumnya'),next=element('button','Berikutnya');prev.type=next.type='button';prev.disabled=state.page===1;next.disabled=state.page===pages;prev.addEventListener('click',()=>{state.page--;rerender();});next.addEventListener('click',()=>{state.page++;rerender();});controls.append(prev,element('strong',`${state.page}/${pages}`),next);pager.append(copy,controls);section.append(pager);}
      }
      root.append(section);
    });
  }
  function render(root, payload, refresh, options = {}) {
    root.replaceChildren(); const heading = element('div', undefined, 'live-heading'), copy = element('div'), actions = element('div', undefined, 'live-actions');
    copy.append(element('h2', options.title || 'Live Sessions'), element('p', options.description || 'Diperbarui otomatis setiap 10 detik untuk ujian yang Anda ampu.'));
    actions.append(element('span', `Terakhir diperbarui ${new Date().toLocaleTimeString('id-ID')}`)); const button = element('button', 'Perbarui sekarang', 'refresh-live'); button.type = 'button'; button.addEventListener('click', refresh); actions.append(button); heading.append(copy, actions);
    const visible=options.enableFilters?filteredPayload(payload):payload;
    if(options.enableFilters)root.append(heading,filterBar(payload,()=>render(root,payload,refresh,options),options.filterFields,options.filterOptions));else root.append(heading);
    const summary = element('section', undefined, 'live-summary'); summary.append(metric('Sedang mengerjakan', visible.summary.active, 'active'), metric('Peserta dipantau', visible.summary.total), metric('Terhubung', visible.summary.online ?? visible.sessions.filter(s=>s.connectionState==='ONLINE').length), metric('Dihentikan', visible.summary.terminated ?? visible.sessions.filter(s=>s.status==='TERMINATED').length, (visible.summary.terminated ?? 0) ? 'danger' : ''));
    const grid = element('section', undefined, 'session-grid');
    if (!visible.sessions.length) { const empty = element('div', undefined, 'live-empty'); empty.append(element('strong', 'Belum ada sesi aktif'), element('p', options.enableFilters?'Tidak ada sesi yang sesuai dengan filter saat ini.':'Sesi siswa akan muncul otomatis setelah mereka mulai mengerjakan ujian yang Anda ampu.')); grid.append(empty); }
    root.append(summary);
    if(!visible.sessions.length)root.append(grid);else appendSessions(root,visible.sessions,options.groupByExam===true,()=>render(root,payload,refresh,options));
  }
  function startClock(root) { clearInterval(clockTimer); clockTimer = setInterval(() => { const elapsed = Math.floor((Date.now() - fetchedAt) / 1000); root.querySelectorAll('[data-remaining]').forEach(node => { node.textContent = duration(Number(node.dataset.remaining) - elapsed); }); }, 1000); }
  function mount(root, api, notice, options = {}) {
    stop(); lastPayload = null; const currentGeneration = generation;
    const load = async () => { if (currentGeneration !== generation) return; try { const response = await api('api/teacher/live-sessions'); if (currentGeneration !== generation) return; lastPayload = response.data; fetchedAt = Date.now(); notice.textContent = ''; render(root, lastPayload, load, options); startClock(root); } catch (error) { notice.textContent = `Live Sessions gagal diperbarui: ${error.message}`; if (!lastPayload) root.replaceChildren(element('div', 'Data live session belum dapat dimuat.', 'live-empty')); } finally { if (currentGeneration === generation) pollTimer = setTimeout(load, 10000); } };
    root.replaceChildren(element('div', 'Menghubungkan ke sesi ujian aktif…', 'live-loading')); load();
  }
  window.CbtLiveSessions = { mount, stop };
})();

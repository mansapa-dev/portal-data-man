(function () {
  'use strict';
  let pollTimer = null, clockTimer = null, generation = 0, lastPayload = null, fetchedAt = 0;
  const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (className) node.className = className; return node; };
  const duration = seconds => { const safe = Math.max(0, Number(seconds) || 0), hours = Math.floor(safe / 3600), minutes = Math.floor((safe % 3600) / 60), secs = Math.floor(safe % 60); return hours > 0 ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`; };
  const statusLabel = status => ({ IN_PROGRESS: 'Mengerjakan', TERMINATED: 'Dihentikan', EXPIRED: 'Waktu habis' }[status] || status);

  function stop() { generation += 1; clearTimeout(pollTimer); clearInterval(clockTimer); pollTimer = null; clockTimer = null; }
  function metric(label, value, tone = '') { const card = element('article', undefined, `live-metric ${tone}`.trim()); card.append(element('strong', value), element('span', label)); return card; }
  function sessionCard(session) {
    const card = element('article', undefined, 'session-card'), head = element('header'), identity = element('div');
    identity.append(element('strong', session.studentName), element('span', `${session.nisn} · ${session.className || '-'}`));
    head.append(identity, element('span', statusLabel(session.status), `session-status status-${session.status.toLowerCase()}`));
    const progressHead = element('div', undefined, 'progress-copy'), progress = element('div', undefined, 'progress-track'), fill = element('span');
    progressHead.append(element('span', `${session.answeredQuestions}/${session.totalQuestions} soal`), element('strong', `${session.progressPercent}%`));
    fill.style.width = `${Math.min(100, Math.max(0, session.progressPercent))}%`; progress.append(fill);
    const meta = element('div', undefined, 'session-meta'), remaining = element('strong', duration(session.remainingSeconds), 'remaining-time');
    remaining.dataset.remaining = String(session.remainingSeconds);
    const time = element('span', '⏱ Sisa '); time.append(remaining);
    meta.append(time, element('span', `⚑ Ragu ${session.flaggedQuestions}`), element('span', `⚠ Pelanggaran ${session.violationCount}`));
    card.append(head, element('p', session.examName, 'session-exam'), progressHead, progress, meta); return card;
  }
  function render(root, payload, refresh) {
    root.replaceChildren(); const heading = element('div', undefined, 'live-heading'), copy = element('div'), actions = element('div', undefined, 'live-actions');
    copy.append(element('h2', 'Live Sessions'), element('p', 'Diperbarui otomatis setiap 10 detik untuk ujian yang Anda ampu.'));
    actions.append(element('span', `Terakhir diperbarui ${new Date().toLocaleTimeString('id-ID')}`)); const button = element('button', 'Perbarui sekarang', 'refresh-live'); button.type = 'button'; button.addEventListener('click', refresh); actions.append(button); heading.append(copy, actions);
    const summary = element('section', undefined, 'live-summary'); summary.append(metric('Sedang mengerjakan', payload.summary.active, 'active'), metric('Total sesi dipantau', payload.summary.total), metric('Jawaban tersimpan', payload.summary.answered), metric('Total pelanggaran', payload.summary.violations, payload.summary.violations ? 'danger' : ''));
    const grid = element('section', undefined, 'session-grid');
    if (!payload.sessions.length) { const empty = element('div', undefined, 'live-empty'); empty.append(element('strong', 'Belum ada sesi aktif'), element('p', 'Sesi siswa akan muncul otomatis setelah mereka mulai mengerjakan ujian yang Anda ampu.')); grid.append(empty); }
    else payload.sessions.forEach(session => grid.append(sessionCard(session)));
    root.append(heading, summary, grid);
  }
  function startClock(root) { clearInterval(clockTimer); clockTimer = setInterval(() => { const elapsed = Math.floor((Date.now() - fetchedAt) / 1000); root.querySelectorAll('[data-remaining]').forEach(node => { node.textContent = duration(Number(node.dataset.remaining) - elapsed); }); }, 1000); }
  function mount(root, api, notice) {
    stop(); lastPayload = null; const currentGeneration = generation;
    const load = async () => { if (currentGeneration !== generation) return; try { const response = await api('api/teacher/live-sessions'); if (currentGeneration !== generation) return; lastPayload = response.data; fetchedAt = Date.now(); notice.textContent = ''; render(root, lastPayload, load); startClock(root); } catch (error) { notice.textContent = `Live Sessions gagal diperbarui: ${error.message}`; if (!lastPayload) root.replaceChildren(element('div', 'Data live session belum dapat dimuat.', 'live-empty')); } finally { if (currentGeneration === generation) pollTimer = setTimeout(load, 10000); } };
    root.replaceChildren(element('div', 'Menghubungkan ke sesi ujian aktif…', 'live-loading')); load();
  }
  window.CbtLiveSessions = { mount, stop };
})();

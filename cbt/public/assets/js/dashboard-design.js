(() => {
  // Separate explicit CBT choices from the old system-derived shared preference.
  const key = 'mansapa-cbt-theme-v2';
  let saved; try { saved = localStorage.getItem(key); } catch (_) {}
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.setAttribute('aria-label', theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
      button.title = button.getAttribute('aria-label');
    });
  }
  apply(saved === 'dark' ? 'dark' : 'light');
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
      saved = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(saved); try { localStorage.setItem(key, saved); } catch (_) {}
    }));
    document.querySelectorAll('.dashboard-metric-action').forEach(card => card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); }
    }));
  });
})();

function overviewNavigate(tab) {
  switchDashTab(tab, document.querySelector('.sb-item[onclick*="' + tab + '"]'));
}
function renderOverviewScores(rows) {
  const chart = document.getElementById('overviewScoreChart');
  chart.replaceChildren();
  const max = Math.max(1, ...rows.map(row => Number(row.total)));
  if (!rows.length) { chart.textContent = 'Belum ada hasil ujian. Analisis akan tampil setelah peserta mengumpulkan jawaban.'; return; }
  ['0–24', '25–49', '50–74', '75–100'].forEach(label => {
    const total = Number(rows.find(row => row.label === label)?.total || 0);
    const column = document.createElement('div'); column.className = 'score-column';
    const value = document.createElement('strong'); value.textContent = total.toLocaleString('id-ID');
    const bar = document.createElement('div'); bar.className = 'score-bar'; bar.style.height = (total / max * 160) + 'px';
    const caption = document.createElement('span'); caption.textContent = label;
    column.append(value, bar, caption); chart.append(column);
  });
}
function loadOverviewSchedule() {
  const target = document.getElementById('overviewSchedule');
  cbtApi.withSuccessHandler(payload => {
    const rows = (Array.isArray(payload) ? payload : payload?.data || []).filter(row => row.status_aktif === true || row.status_aktif === 1).sort((a,b) => String(a.tanggal_ujian || '').localeCompare(String(b.tanggal_ujian || ''))).slice(0, 4);
    target.replaceChildren();
    if (!rows.length) { target.textContent = 'Belum ada jadwal ujian aktif.'; return; }
    rows.forEach(row => {
      const button = document.createElement('button'); button.className = 'overview-exam-row'; button.type = 'button';
      const icon = document.createElement('i'); icon.className = 'fa-regular fa-calendar'; icon.setAttribute('aria-hidden', 'true');
      const name = document.createElement('strong'); name.textContent = row.nama_ujian;
      const detail = document.createElement('span'); detail.textContent = (row.nama_mapel || 'Ujian') + ' · ' + (row.tanggal_ujian || 'Tanggal belum ditetapkan');
      const badge = document.createElement('small'); badge.textContent = 'Sesi ' + (row.sesi || 1);
      button.append(icon, name, detail, badge); button.addEventListener('click', () => overviewNavigate('tabAdminUjian')); target.append(button);
    });
  }).withFailureHandler(() => { target.textContent = 'Jadwal gagal dimuat. Gunakan tombol perbarui untuk mencoba lagi.'; }).getAdminUjianList(stPengelola);
}

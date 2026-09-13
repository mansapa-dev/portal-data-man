const list = document.querySelector('#journal-list');
const search = document.querySelector('#journal-search');
const status = document.querySelector('#journal-status');
let timer;

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

function statusLabel(value) {
  return { DRAFT: 'Draft', FINAL: 'Final', AMENDED: 'Direvisi' }[value] ?? value;
}

function emptyState(filtered) {
  const title = filtered ? 'Tidak ada jurnal yang cocok' : 'Belum ada jurnal kelas';
  const description = filtered
    ? 'Coba kata kunci lain atau tampilkan semua status jurnal.'
    : 'Mulai dari absensi kelas, lalu catat kegiatan pembelajaran setelah absensi selesai.';
  const action = filtered
    ? '<button type="button" data-reset-filters>Hapus filter</button>'
    : '<a class="primary" href="/attendance/create">Buat absensi pertama</a>';
  return `<div class="journal-empty"><span class="journal-empty-icon" aria-hidden="true">✎</span><h2>${title}</h2><p>${description}</p>${action}</div>`;
}

async function load() {
  const query = new URLSearchParams(location.search);
  if (search.value) query.set('search', search.value);
  else query.delete('search');
  if (status.value) query.set('status', status.value);
  else query.delete('status');
  history.replaceState(null, '', query.size ? `${location.pathname}?${query}` : location.pathname);
  list.innerHTML = '<div class="loading-state">Memuat jurnal…</div>';

  try {
    const response = await fetch(`/api/journals?${query}`, { credentials: 'same-origin' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || 'Jurnal gagal dimuat.');
    const items = body.data.items;
    list.innerHTML = items.length
      ? items.map(journal => `<a href="/journals/${journal.publicId}"><div><strong>${escapeHtml(journal.className)} · ${escapeHtml(journal.subjectName)}</strong><span>${journal.journalDate} · Jam ${journal.periodStart}${journal.periodEnd !== journal.periodStart ? '–' + journal.periodEnd : ''} · ${journal.documentationCount} foto</span><p>${escapeHtml(journal.topic.length > 120 ? journal.topic.slice(0, 120) + '…' : journal.topic)}</p></div><b class="status status-${journal.status.toLowerCase()}">${statusLabel(journal.status)}</b></a>`).join('')
      : emptyState(Boolean(search.value || status.value));
  } catch (error) {
    list.innerHTML = `<div class="journal-empty" role="alert"><span class="journal-empty-icon" aria-hidden="true">!</span><h2>Jurnal belum bisa dimuat</h2><p>${escapeHtml(error.message)}</p><button type="button" data-retry>Coba lagi</button></div>`;
  }
}

function changed() {
  clearTimeout(timer);
  timer = setTimeout(load, 250);
}

const params = new URLSearchParams(location.search);
search.value = params.get('search') ?? '';
status.value = params.get('status') ?? '';
search.addEventListener('input', changed);
status.addEventListener('change', load);
list.addEventListener('click', event => {
  if (event.target.closest('[data-reset-filters]')) {
    search.value = '';
    status.value = '';
    load();
  }
  if (event.target.closest('[data-retry]')) load();
});
load();

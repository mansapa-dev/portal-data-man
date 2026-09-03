// Scheduling of individual make-up/remedial exams. A new exam is created from the selected source.
let followUpExams = [];
let followUpStudents = [];
let selectedFollowUpStudents = new Set();

function loadDataFollowUpExams() {
  const box = document.getElementById('followUpStudents');
  if (box) box.innerHTML = '<div style="padding:18px;text-align:center;">Memuat peserta...</div>';
  cbtApi.withSuccessHandler(exams => {
    followUpExams = Array.isArray(exams) ? exams : (exams?.data || []);
    const select = document.getElementById('followUpSource');
    if (select) select.innerHTML = '<option value="">Pilih ujian yang sudah memiliki soal</option>' + followUpExams.map(e => `<option value="${e.id}">${e.nama_ujian} — Tingkat ${e.tingkat}</option>`).join('');
  }).withFailureHandler(err => showCustomAlert('Gagal Memuat Ujian', err.message, 'error')).getAdminUjianList(stPengelola);
  cbtApi.withSuccessHandler(rows => {
    followUpStudents = Array.isArray(rows) ? rows : (rows?.data || []);
    renderFollowUpStudents();
  }).withFailureHandler(err => { if (box) box.innerHTML = `<div style="padding:18px;color:var(--danger);">${err.message}</div>`; }).getAdminSiswaList(stPengelola);
}

function renderFollowUpStudents() {
  const box = document.getElementById('followUpStudents');
  if (!box) return;
  const query = (document.getElementById('followUpStudentSearch')?.value || '').toLowerCase().trim();
  const source = followUpExams.find(e => String(e.id) === String(document.getElementById('followUpSource')?.value));
  const rows = followUpStudents.filter(s => {
    const matchesSource = !source || String(s.tingkat || '').toUpperCase() === String(source.tingkat || '').toUpperCase();
    const matchesSearch = !query || `${s.nisn || ''} ${s.nomor_ujian || ''} ${s.nama || ''} ${s.kelas || ''}`.toLowerCase().includes(query);
    return matchesSource && matchesSearch;
  });
  box.innerHTML = rows.length ? rows.map(s => `<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;"><input type="checkbox" value="${s.id}" ${selectedFollowUpStudents.has(String(s.id)) ? 'checked' : ''} onchange="toggleFollowUpStudent(this.value,this.checked)"><span><b>${s.nama || '-'}</b><br><small style="color:var(--text-muted);">${s.nomor_ujian || s.nisn || '-'} · ${s.kelas || '-'} · Tingkat ${s.tingkat || '-'}</small></span></label>`).join('') : '<div style="padding:18px;text-align:center;color:var(--text-muted);">Tidak ada siswa yang sesuai.</div>';
  const count = document.getElementById('followUpStudentCount');
  if (count) count.textContent = `(${selectedFollowUpStudents.size} dipilih)`;
}
function toggleFollowUpStudent(id, checked) { if (checked) selectedFollowUpStudents.add(String(id)); else selectedFollowUpStudents.delete(String(id)); renderFollowUpStudents(); }
document.getElementById('followUpSource').addEventListener('change', () => { selectedFollowUpStudents.clear(); renderFollowUpStudents(); });
document.getElementById('formUjianLanjutan').addEventListener('submit', e => {
  e.preventDefault();
  const starts = document.getElementById('followUpStarts').value;
  const ends = document.getElementById('followUpEnds').value;
  if (!selectedFollowUpStudents.size) return showCustomAlert('Peserta Belum Dipilih', 'Pilih minimal satu siswa untuk jadwal ini.', 'warning');
  showLoading('Membuat jadwal ujian khusus...');
  cbtApi.withSuccessHandler(res => { hideLoading(); selectedFollowUpStudents.clear(); document.getElementById('formUjianLanjutan').reset(); renderFollowUpStudents(); showCustomAlert('Jadwal Berhasil Dibuat', `${res.name} dibuat untuk ${res.targeted_students} siswa.`, 'success'); }).withFailureHandler(err => { hideLoading(); showCustomAlert('Gagal Membuat Jadwal', err.message, 'error'); }).simpanUjianLanjutanAdmin(stPengelola, { type: document.getElementById('followUpType').value, source_exam_id: document.getElementById('followUpSource').value, name: document.getElementById('followUpName').value.trim(), starts_at: starts.replace('T', ' '), ends_at: ends.replace('T', ' '), student_ids: [...selectedFollowUpStudents], active: true });
});

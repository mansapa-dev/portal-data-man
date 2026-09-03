// Scheduling of individual make-up/remedial exams. A new exam is created from the selected source.
let followUpExams = [];
let followUpStudents = [];
let selectedFollowUpStudents = new Set();
let followUpCandidates = [];
let followUpSchedules = [];

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
  loadFollowUpCandidateTable();
  loadFollowUpScheduleTable();
}

function loadFollowUpCandidateTable() {
  cbtApi.withSuccessHandler(rows => { followUpCandidates = Array.isArray(rows) ? rows : []; renderFollowUpCandidates(); })
    .withFailureHandler(err => { document.getElementById('tblFollowUpCandidates').innerHTML = `<tr><td colspan="5" align="center">${err.message}</td></tr>`; }).getKandidatUjianLanjutan();
}
function renderFollowUpCandidates() {
  const tb = document.getElementById('tblFollowUpCandidates'); if (!tb) return;
  if (!followUpCandidates.length) { tb.innerHTML = '<tr><td colspan="5" align="center" style="padding:22px;color:var(--text-muted);">Belum ada siswa dengan 3 pelanggaran.</td></tr>'; return; }
  tb.innerHTML = followUpCandidates.map(c => `<tr><td><b>${c.name}</b><br><small>${c.nisn}</small></td><td>${c.class || '-'}<br><small>Tingkat ${c.grade || '-'}</small></td><td>${c.exam_name}</td><td><span class="badge bg-red">${c.violation_count} kali</span></td><td style="white-space:nowrap;"><button class="btn btn-secondary" style="padding:5px 8px;font-size:11px;" onclick="prepareFollowUpCandidate(${c.student_id},${c.exam_id},'SUSULAN')">Susulan</button> <button class="btn btn-primary" style="padding:5px 8px;font-size:11px;" onclick="prepareFollowUpCandidate(${c.student_id},${c.exam_id},'REMEDIAL')">Remedial</button></td></tr>`).join('');
}
function prepareFollowUpCandidate(studentId, examId, type) {
  selectedFollowUpStudents = new Set([String(studentId)]);
  document.getElementById('followUpType').value = type;
  document.getElementById('followUpSource').value = String(examId);
  renderFollowUpStudents();
  document.getElementById('formUjianLanjutan').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function loadFollowUpScheduleTable() {
  cbtApi.withSuccessHandler(rows => { followUpSchedules = Array.isArray(rows) ? rows : []; renderFollowUpSchedules(); })
    .withFailureHandler(err => { document.getElementById('tblFollowUpSchedules').innerHTML = `<tr><td colspan="6" align="center">${err.message}</td></tr>`; }).getJadwalUjianLanjutan();
}
function renderFollowUpSchedules() {
  const tb = document.getElementById('tblFollowUpSchedules'); if (!tb) return;
  if (!followUpSchedules.length) { tb.innerHTML = '<tr><td colspan="6" align="center" style="padding:22px;color:var(--text-muted);">Belum ada jadwal susulan/remedial.</td></tr>'; return; }
  tb.innerHTML = followUpSchedules.map(s => { const active = s.status === 'ACTIVE'; return `<tr><td><span class="badge ${s.type === 'REMEDIAL' ? 'bg-blue' : 'bg-gray'}">${s.type}</span></td><td><b>${s.name}</b><br><small>Asal: ${s.source_name}</small></td><td>${s.student_count} siswa<br><small>${s.students || '-'}</small></td><td><small>${String(s.starts_at).replace('T',' ').slice(0,16)}<br>s.d. ${String(s.ends_at).replace('T',' ').slice(0,16)}</small></td><td><span class="badge ${active ? 'bg-green' : 'bg-red'}">${active ? 'AKTIF' : 'NONAKTIF'}</span></td><td><button class="btn ${active ? 'btn-secondary' : 'btn-primary'}" style="padding:5px 8px;font-size:11px;" onclick="toggleFollowUpSchedule(${s.id},${active ? 'false' : 'true'})"><i class="fa-solid fa-power-off"></i> ${active ? 'Nonaktifkan' : 'Aktifkan'}</button></td></tr>`; }).join('');
}
function toggleFollowUpSchedule(id, active) {
  showLoading(active ? 'Mengaktifkan jadwal...' : 'Menonaktifkan jadwal...');
  cbtApi.withSuccessHandler(() => { hideLoading(); loadFollowUpScheduleTable(); showCustomAlert('Status Diperbarui', active ? 'Jadwal kini aktif untuk siswa yang dituju.' : 'Jadwal kini tidak dapat diakses siswa.', 'success'); }).withFailureHandler(err => { hideLoading(); showCustomAlert('Gagal Memperbarui Status', err.message, 'error'); }).setStatusUjianLanjutan(stPengelola, id, active);
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
  cbtApi.withSuccessHandler(res => { hideLoading(); selectedFollowUpStudents.clear(); document.getElementById('formUjianLanjutan').reset(); renderFollowUpStudents(); loadFollowUpScheduleTable(); showCustomAlert('Jadwal Berhasil Dibuat', `${res.name} dibuat untuk ${res.targeted_students} siswa.`, 'success'); }).withFailureHandler(err => { hideLoading(); showCustomAlert('Gagal Membuat Jadwal', err.message, 'error'); }).simpanUjianLanjutanAdmin(stPengelola, { type: document.getElementById('followUpType').value, source_exam_id: document.getElementById('followUpSource').value, name: document.getElementById('followUpName').value.trim(), starts_at: starts.replace('T', ' '), ends_at: ends.replace('T', ' '), student_ids: [...selectedFollowUpStudents], active: true });
});

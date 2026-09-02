// Staff authentication, dashboard navigation, session restoration, and Portal references.
document.getElementById('formLoginPengelola').addEventListener('submit', function(e){
  e.preventDefault();
  const u = document.getElementById('inUserPengelola').value;
  const p = document.getElementById('inPassPengelola').value;
  const alert = document.getElementById('alertLoginPengelola'); alert.className = 'alert';
  
  showLoading('Otentikasi...');
  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      if(res && res.success) {
        document.getElementById('modalLoginPengelola').classList.remove('show');
        stPengelola = { userId: res.userId || res.id, id: res.userId || res.id, role: res.role, nama: res.nama, username: u };
        initDashboardPengelola(res.nama, res.role);
      } else { alert.className = 'alert error'; alert.textContent = res?.message || 'Gagal login.'; }
    })
    .withFailureHandler(err => { hideLoading(); alert.className = 'alert error'; alert.textContent = 'Error: ' + err.message; })
    .loginPenggunaAPI(u, p);
});

function initDashboardPengelola(nama, role) {
  const cleanRole = String(role || 'guru').toLowerCase().trim();
  document.getElementById('lblRolePengelola').textContent = cleanRole === 'admin' ? 'ADMINISTRATOR' : 'GURU MATA PELAJARAN';
  document.getElementById('lblNamaPengelola').textContent = nama;
  document.getElementById('lblIdentitasPengelola').textContent = `User: @${stPengelola.username}`;
  
  document.getElementById('menuAdmin').classList.add('hidden');
  document.getElementById('menuGuru').classList.add('hidden');
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.add('hidden'));

  if (cleanRole === 'admin') {
    document.getElementById('menuAdmin').classList.remove('hidden');
    document.getElementById('tabAdminOverview').classList.remove('hidden');
    loadDataAdminDash();
  } else {
    document.getElementById('menuGuru').classList.remove('hidden');
    document.getElementById('tabGuruMonitor').classList.remove('hidden');
    loadDataGuru();
  }
  switchView('viewDashboardPengelola');
}

function switchDashTab(tabId, btnEl) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.add('hidden'));
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  
  if(tabId === 'tabAdminOverview') loadDataAdminDash();
  if(tabId === 'tabAdminUjian') loadDataAdminUjian();
  if(tabId === 'tabAdminSoal') loadDataAdminSoal();
  if(tabId === 'tabAdminSiswa') loadDataAdminSiswa();
  if(tabId === 'tabAdminLogPelanggaran') loadDataAdminLogPelanggaran();
  if(tabId === 'tabAdminHasil') loadDataAdminHasil();
  if(tabId === 'tabAdminKartu') loadDataAdminKartu();
  if(tabId === 'tabAdminGuruUjian') loadDataAdminGuruUjian();
  if(tabId === 'tabAdminAkun') loadDataAdminAkun();
  if(tabId === 'tabGuruMonitor') loadDataGuru();
}

function loadDataAdminDash() {
  cbtApi
    .withSuccessHandler(res => {
      if(res && res.success){
        document.getElementById('statJmlSiswa').textContent = res.totalSiswa;
        document.getElementById('statJmlUjian').textContent = res.totalUjianAktif;
        document.getElementById('statJmlSubmit').textContent = res.totalSubmit;
        document.getElementById('statJmlPelanggaran').textContent = res.totalPelanggaran || 0;
      }
    })
    .getAdminDashboardStats(stPengelola);
}

function loadPortalReferences(onReady) {
  cbtApi.withSuccessHandler(res => {
    if (res.success) { portalReferences = res; portalReferencesLoaded = true; }
    if (typeof onReady === 'function') onReady(portalReferences);
  }).withFailureHandler(err => showCustomAlert('Referensi Portal Data', err.message)).getPortalDataReferences();
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await fetch('api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload.success) return;
    const staff = payload.data.staff;
    const student = payload.data.student;
    if (staff?.role === 'TEACHER') { window.location.replace('guru/dashboard'); return; }
    if (staff?.role === 'ADMIN') {
      stPengelola = { userId: staff.id, id: staff.id, role: 'admin', nama: staff.nama, username: staff.username };
      initDashboardPengelola(staff.nama, 'admin');return;
    }
    if (student) {
      stSiswa = { id: student.id, nama: student.nama, kelas: student.kelas, no: student.nisn };
      document.getElementById('lblNamaSiswa').textContent = stSiswa.nama;
      document.getElementById('lblKelasSiswa').textContent = stSiswa.kelas;
      document.getElementById('lblNoSiswa').textContent = stSiswa.no;
      cbtApi.withSuccessHandler(result => {
        renderDaftarJadwal(result.jadwal);switchView('viewPortalSiswa');
        const active = result.jadwal.find(exam => exam.status_pengerjaan === 'berlangsung');
        if (active) persiapkanUjian(active);
      }).withFailureHandler(() => switchView('viewPortalSiswa')).getStudentExamsAPI();
    }
  } catch (_) { /* Guest atau server belum siap: pertahankan layar login. */ }
});

function populateExamPortalOptions(data = null) {
  document.getElementById('inSubjectUjian').innerHTML = portalReferences.subjects.map(s => `<option value="${s.id}">${s.code} — ${s.name}</option>`).join('');
  const grades = [...new Set(portalReferences.classes.map(c => c.grade).filter(Boolean))];
  document.getElementById('inTingkatUjian').innerHTML = grades.map(g => `<option value="${g}">${g}</option>`).join('');
  document.getElementById('inTahunAjaran').innerHTML = portalReferences.academic_years.map(y => `<option value="${y.portal_academic_year_id}">${y.name}${Number(y.is_active) ? ' (Aktif)' : ''}</option>`).join('');
  const activeYear = portalReferences.academic_years.find(y => Number(y.is_active));
  if (!data && activeYear) document.getElementById('inTahunAjaran').value = activeYear.portal_academic_year_id;
  refreshSemesterOptions(data?.portal_semester_id || '');
  refreshClassOptions();
}

function refreshClassOptions(selected = []) {
  const grade = document.getElementById('inTingkatUjian').value;
  const year = portalReferences.academic_years.find(y => y.portal_academic_year_id === document.getElementById('inTahunAjaran').value)?.name;
  const classes = portalReferences.classes.filter(c => (!grade || c.grade === grade) && (!year || c.academic_year === year));
  document.getElementById('inKelasTarget').innerHTML = classes.map(c => `<option value="${c.portal_class_id}"${selected.includes(c.portal_class_id) ? ' selected' : ''}>${c.code} — ${c.name}</option>`).join('');
}

function refreshSemesterOptions(selected = '') {
  const yearId = document.getElementById('inTahunAjaran').value;
  const semesters = portalReferences.semesters.filter(s => s.portal_academic_year_id === yearId);
  document.getElementById('inSemester').innerHTML = semesters.map(s => `<option value="${s.portal_semester_id}">${s.type === 'ODD' ? 'Ganjil' : 'Genap'}${Number(s.is_active) ? ' (Aktif)' : ''}</option>`).join('');
  if (selected) document.getElementById('inSemester').value = selected;
}

document.getElementById('inTahunAjaran').addEventListener('change', () => { refreshSemesterOptions(); refreshClassOptions(); });
document.getElementById('inTingkatUjian').addEventListener('change', () => refreshClassOptions());

function sinkronkanSemuaPortalData() {
  const types = ['academic_years', 'semesters', 'classes', 'students', 'teachers'];
  const summaries = [];
  showLoading('Sinkronisasi referensi Portal Data...');
  const next = index => {
    if (index >= types.length) {
      hideLoading(); loadPortalReferences(); loadDataAdminSiswa();
      showCustomAlert('Sinkronisasi selesai', summaries.map(s => `${s.type}: ${s.total || 0} data`).join('\n'));
      return;
    }
    cbtApi.withSuccessHandler(res => { summaries.push({ type: types[index], ...res }); next(index + 1); })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Sinkronisasi gagal', `${types[index]}: ${err.message}`); })
      .syncPortalData(types[index]);
  };
  next(0);
}

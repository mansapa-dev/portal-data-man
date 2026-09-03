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
  const roleTitle = cleanRole === 'admin' ? 'ADMINISTRATOR' : 'GURU MAPEL';
  const initial = (nama || 'A').trim().charAt(0).toUpperCase();

  const elRole = document.getElementById('lblRolePengelola');
  if (elRole) elRole.textContent = roleTitle;
  const elNama = document.getElementById('lblNamaPengelola');
  if (elNama) elNama.textContent = nama;
  const elIdentitas = document.getElementById('lblIdentitasPengelola');
  if (elIdentitas) elIdentitas.textContent = `@${stPengelola.username || 'user'}`;

  // Topbar Controls
  updateTopbarAuthUI(true);

  // Sidebar Avatar
  const elAvatarSide = document.getElementById('sidebarAvatarInitial');
  if (elAvatarSide) elAvatarSide.textContent = initial;

  // Hero Welcome
  const elHeroName = document.getElementById('heroWelcomeName');
  if (elHeroName) elHeroName.textContent = nama;
  const elHeroDate = document.getElementById('heroCurrentDate');
  if (elHeroDate) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    elHeroDate.textContent = new Date().toLocaleDateString('id-ID', options);
  }
  
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

const tabTitles = {
  'tabAdminOverview': 'Ringkasan Sistem',
  'tabAdminUjian': 'Kelola Ujian & Arsip',
  'tabAdminSoal': 'Kelola Bank Soal',
  'tabAdminSiswa': 'Kontrol & Siswa',
  'tabAdminLogPelanggaran': 'Log Pelanggaran Siswa',
  'tabAdminHasil': 'Rekap & Laporan Hasil',
  'tabAdminKartu': 'Cetak Kartu Ujian',
  'tabAdminGuruUjian': 'Penugasan Guru Mapel',
  'tabAdminAkun': 'Kelola Akun Staff',
  'tabGuruMonitor': 'Ujian & Mapel Diampu'
};

function switchDashTab(tabId, btnEl) {
  if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.add('hidden'));
  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.remove('hidden');
  document.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  const elCurrentTab = document.getElementById('topbarCurrentTab');
  if (elCurrentTab && tabTitles[tabId]) {
    elCurrentTab.textContent = tabTitles[tabId];
  }
  
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

function handleGlobalSearch(query) {
  const activeTab = document.querySelector('.dash-tab:not(.hidden)');
  if (!activeTab) return;
  const input = activeTab.querySelector('.search-box input');
  if (input) {
    input.value = query;
    input.dispatchEvent(new Event('keyup'));
  }
}

function loadDataAdminDash() {
  cbtApi
    .withSuccessHandler(res => {
      if(res && res.success){
        document.getElementById('statJmlSiswa').textContent = (res.totalSiswa || 0).toLocaleString('id-ID');
        document.getElementById('statJmlUjian').textContent = (res.totalUjianAktif || 0).toLocaleString('id-ID');
        document.getElementById('statJmlSubmit').textContent = (res.totalSubmit || 0).toLocaleString('id-ID');
        document.getElementById('statJmlPelanggaran').textContent = (res.totalPelanggaran || 0).toLocaleString('id-ID');
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
    if (!response.ok || !payload.success) {
      updateTopbarAuthUI(false);
      return;
    }
    const staff = payload.data.staff;
    const student = payload.data.student;
    if (staff?.role === 'TEACHER') { window.location.replace('guru/dashboard'); return; }
    if (staff?.role === 'ADMIN') {
      stPengelola = { userId: staff.id, id: staff.id, role: 'admin', nama: staff.nama, username: staff.username };
      initDashboardPengelola(staff.nama, 'admin');
      return;
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
      return;
    }
    updateTopbarAuthUI(false);
  } catch (_) {
    updateTopbarAuthUI(false);
  }
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
  const grade = document.getElementById('inTingkatUjian')?.value || '';
  const year = portalReferences.academic_years.find(y => y.portal_academic_year_id === document.getElementById('inTahunAjaran')?.value)?.name;
  const classes = portalReferences.classes.filter(c => (!grade || c.grade === grade) && (!year || c.academic_year === year));

  const selectEl = document.getElementById('inKelasTarget');
  const container = document.getElementById('containerCheckboxesKelas');

  if (selectEl) {
    selectEl.innerHTML = classes.map(c => `
      <option value="${c.portal_class_id}"${selected.includes(c.portal_class_id) || selected.includes(c.name) ? ' selected' : ''}>${c.name || c.code}</option>
    `).join('');
  }

  if (container) {
    if (classes.length === 0) {
      container.innerHTML = `<div style="padding:10px; font-size:12px; color:var(--text-muted); text-align:center;">Tidak ada data rombel untuk tingkat ini.</div>`;
    } else {
      container.innerHTML = classes.map(c => {
        const isChecked = selected.includes(c.portal_class_id) || selected.includes(c.name);
        return `
          <label style="display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:6px; cursor:pointer; font-size:12.5px; user-select:none;" onmouseover="this.style.background='var(--surface-subtle)'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" value="${c.portal_class_id}" data-name="${c.name || c.code}" class="cb-kelas-item" ${isChecked ? 'checked' : ''} onchange="onKelasCheckboxChange()" style="cursor:pointer; accent-color:var(--primary); width:15px; height:15px;">
            <span style="font-weight:600; color:var(--text-main);">${c.name || c.code}</span>
          </label>
        `;
      }).join('');
    }
  }

  updateLabelSelectedKelas();
}

function updateLabelSelectedKelas() {
  const checkboxes = document.querySelectorAll('.cb-kelas-item:checked');
  const lbl = document.getElementById('lblSelectedKelas');
  const selectEl = document.getElementById('inKelasTarget');

  if (checkboxes.length === 0) {
    if (lbl) lbl.textContent = 'Semua Kelas (Opsional)';
    if (selectEl) Array.from(selectEl.options).forEach(o => o.selected = false);
  } else {
    const names = Array.from(checkboxes).map(cb => cb.dataset.name || cb.value);
    const vals = Array.from(checkboxes).map(cb => cb.value);
    if (lbl) {
      lbl.textContent = names.length > 3 ? `${names.length} Kelas (${names.slice(0, 2).join(', ')}...)` : names.join(', ');
    }
    if (selectEl) {
      Array.from(selectEl.options).forEach(o => {
        o.selected = vals.includes(o.value);
      });
    }
  }
}

function onKelasCheckboxChange() {
  updateLabelSelectedKelas();
}

function toggleKelasDropdown() {
  const list = document.getElementById('listKelasDropdown');
  if (list) list.classList.toggle('hidden');
}

function toggleSelectAllKelas() {
  const checkboxes = document.querySelectorAll('.cb-kelas-item');
  if (checkboxes.length === 0) return;
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => cb.checked = !allChecked);
  updateLabelSelectedKelas();
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('wrapKelasDropdown');
  const list = document.getElementById('listKelasDropdown');
  if (wrap && list && !wrap.contains(e.target)) {
    list.classList.add('hidden');
  }
});

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

// Teacher-to-exam assignment management.
function loadDataAdminGuruUjian() {
  const tb = document.getElementById('tblAdminGuruUjian'); tb.innerHTML = `<tr><td colspan="5" align="center">Memuat...</td></tr>`;
  cbtApi
    .withSuccessHandler(res => {
      if(!res.success || !res.data || res.data.length === 0) {
        tb.innerHTML = `<tr><td colspan="5" align="center">Belum ada penugasan guru / piket ujian.</td></tr>`;
        window.cacheGuruList = res.guruList || [];
        window.cachePegawaiList = res.pegawaiList || [];
        window.cacheUjianList = res.ujianList || [];
        renderTeacherProctorEligibility();
        return;
      }
      window.cacheGuruList = res.guruList || [];
      window.cachePegawaiList = res.pegawaiList || [];
      window.cacheUjianList = res.ujianList || [];
      window.cacheGuruUjianData = res.data;
      renderTeacherProctorEligibility();
      
      tb.innerHTML = res.data.map(r => `
        <tr>
          <td><b>${r.nama_guru}</b></td>
          <td>${r.nama_ujian}</td>
          <td><span class="badge ${r.duty_role === 'PROCTOR' ? 'bg-blue' : 'bg-gray'}">${r.duty_role === 'PROCTOR' ? 'Petugas Piket Ujian' : 'Guru Mapel'}</span></td>
          <td><span class="badge bg-gray">Tingkat ${r.tingkat}</span></td>
          <td style="display:flex; gap:6px;">
            <button class="btn btn-secondary" style="padding:4px 10px; font-size:11px;" onclick="editGuruUjianById(${r.id})"><i class="fa-solid fa-pen"></i> Edit</button>
            <button class="btn btn-danger" style="padding:4px 10px; font-size:11px;" onclick="hapusGuruUjian(${r.id})"><i class="fa-solid fa-trash"></i> Hapus</button>
          </td>
        </tr>
      `).join('');
    })
    .getAdminGuruUjianList(stPengelola);
}

function bukaModalGuruUjian() {
  document.getElementById('formGuruUjian').reset();
  document.getElementById('editGuruUjianId').value = '';
  document.getElementById('titleModalGuruUjian').textContent = 'Form Penugasan Guru / Piket';
  
  const selGuru = document.getElementById('inGuruId');
  const selUjian = document.getElementById('inUjianId');
  
  refreshPersonnelOptions();
  selUjian.innerHTML = (window.cacheUjianList || []).map(u => `<option value="${u.id}">${u.nama_mapel || 'Mapel'} — ${u.nama_ujian} (Sesi ${u.sesi || 1}) - Tingkat ${u.tingkat}</option>`).join('');
  
  document.getElementById('modalGuruUjian').classList.add('show');
}

function editGuruUjianById(id) {
  const r = (window.cacheGuruUjianData || []).find(x => String(x.id) === String(id));
  if (r) editGuruUjian(r);
}

function editGuruUjian(r) {
  document.getElementById('formGuruUjian').reset();
  document.getElementById('editGuruUjianId').value = r.id;
  document.getElementById('titleModalGuruUjian').textContent = 'Edit Penugasan Guru / Piket';
  
  const selGuru = document.getElementById('inGuruId');
  const selUjian = document.getElementById('inUjianId');
  
  document.getElementById('inDutyRole').value = r.duty_role || 'TEACHER';
  refreshPersonnelOptions(r.person_type || 'TEACHER', r.employee_id || r.guru_id);
  selUjian.innerHTML = (window.cacheUjianList || []).map(u => `<option value="${u.id}">${u.nama_mapel || 'Mapel'} — ${u.nama_ujian} (Sesi ${u.sesi || 1}) - Tingkat ${u.tingkat}</option>`).join('');
  
  selUjian.value = r.ujian_id;
  
  document.getElementById('modalGuruUjian').classList.add('show');
}

document.getElementById('formGuruUjian').addEventListener('submit', function(e){
  e.preventDefault();
  const payload = {
    id: document.getElementById('editGuruUjianId').value || null,
    person_id: document.getElementById('inGuruId').value,
    person_type: document.getElementById('inGuruId').selectedOptions[0]?.dataset.type || 'TEACHER',
    ujian_id: document.getElementById('inUjianId').value,
    duty_role: document.getElementById('inDutyRole').value
  };
  showLoading('Menyimpan penugasan...');
  cbtApi
    .withSuccessHandler(res => { 
      hideLoading(); 
      if(res.success){ 
        document.getElementById('modalGuruUjian').classList.remove('show'); 
        loadDataAdminGuruUjian(); 
      } else {
        showCustomAlert('Gagal', res.message);
      }
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .simpanGuruUjianAdmin(stPengelola, payload);
});

document.getElementById('inDutyRole').addEventListener('change', () => refreshPersonnelOptions());

function refreshPersonnelOptions(selectedType, selectedId) {
  const duty = document.getElementById('inDutyRole').value;
  const select = document.getElementById('inGuruId');
  const teachers = (window.cacheGuruList || []).filter(g => duty === 'TEACHER' || Number(g.proctor_eligible) === 1)
    .map(g => ({...g, person_type:'TEACHER', suffix:duty === 'PROCTOR' ? 'Guru diizinkan' : 'Guru mapel'}));
  const people = duty === 'TEACHER' ? teachers : [
    ...(window.cachePegawaiList || []).map(p => ({...p, person_type:'EMPLOYEE', suffix:p.jabatan || 'Pegawai'})),
    ...teachers
  ];
  document.getElementById('labelPersonel').textContent = duty === 'TEACHER' ? 'Pilih Guru Mata Pelajaran' : 'Pilih Petugas Piket';
  select.innerHTML = people.map(p => `<option value="${p.id}" data-type="${p.person_type}">${p.nama_lengkap || p.username} — ${p.suffix}</option>`).join('');
  if(selectedId) select.value = String(selectedId);
}

function renderTeacherProctorEligibility() {
  const root = document.getElementById('teacherProctorEligibility');
  if(!root) return;
  const teachers = window.cacheGuruList || [];
  root.innerHTML = `<h4 style="margin-bottom:8px">Guru yang Boleh Menjadi Piket</h4><p style="margin-bottom:10px">Centang hanya guru yang memang mendapat tugas piket. Mencabut izin juga menghapus penugasan piket guru tersebut.</p>` +
    (teachers.length ? teachers.map(g => `<label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" ${Number(g.proctor_eligible)===1?'checked':''} onchange="setTeacherProctorEligibility(${g.id},this.checked)"> ${g.nama_lengkap}</label>`).join('') : '<p>Sinkronkan data guru terlebih dahulu.</p>');
}

function setTeacherProctorEligibility(id, eligible) {
  cbtApi.withSuccessHandler(() => loadDataAdminGuruUjian()).withFailureHandler(err => { showCustomAlert('Error',err.message); loadDataAdminGuruUjian(); }).setTeacherProctorEligibility(stPengelola,id,eligible);
}

function hapusGuruUjian(id) {
  showCustomConfirm("Hapus Penugasan", "Hapus penugasan guru ini?", () => {
    showLoading('Menghapus...');
    cbtApi
      .withSuccessHandler(res => { 
        hideLoading(); 
        if(res.success) loadDataAdminGuruUjian(); 
        else showCustomAlert('Gagal', res.message);
      })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
      .hapusGuruUjianAdmin(stPengelola, id);
  });
}

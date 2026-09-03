// Teacher-to-exam assignment management.
function loadDataAdminGuruUjian() {
  const tb = document.getElementById('tblAdminGuruUjian'); tb.innerHTML = `<tr><td colspan="4" align="center">Memuat...</td></tr>`;
  cbtApi
    .withSuccessHandler(res => {
      if(!res.success || !res.data || res.data.length === 0) {
        tb.innerHTML = `<tr><td colspan="4" align="center">Belum ada penugasan guru mapel.</td></tr>`;
        window.cacheGuruList = res.guruList || [];
        window.cacheUjianList = res.ujianList || [];
        return;
      }
      window.cacheGuruList = res.guruList || [];
      window.cacheUjianList = res.ujianList || [];
      window.cacheGuruUjianData = res.data;
      
      tb.innerHTML = res.data.map(r => `
        <tr>
          <td><b>${r.nama_guru}</b></td>
          <td>${r.nama_ujian}</td>
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
  document.getElementById('titleModalGuruUjian').textContent = 'Form Penugasan Guru Mapel';
  
  const selGuru = document.getElementById('inGuruId');
  const selUjian = document.getElementById('inUjianId');
  
  selGuru.innerHTML = (window.cacheGuruList || []).map(g => `<option value="${g.id}">${g.nama_lengkap || g.username}</option>`).join('');
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
  document.getElementById('titleModalGuruUjian').textContent = 'Edit Penugasan Guru Mapel';
  
  const selGuru = document.getElementById('inGuruId');
  const selUjian = document.getElementById('inUjianId');
  
  selGuru.innerHTML = (window.cacheGuruList || []).map(g => `<option value="${g.id}">${g.nama_lengkap || g.username}</option>`).join('');
  selUjian.innerHTML = (window.cacheUjianList || []).map(u => `<option value="${u.id}">${u.nama_mapel || 'Mapel'} — ${u.nama_ujian} (Sesi ${u.sesi || 1}) - Tingkat ${u.tingkat}</option>`).join('');
  
  selGuru.value = r.guru_id;
  selUjian.value = r.ujian_id;
  
  document.getElementById('modalGuruUjian').classList.add('show');
}

document.getElementById('formGuruUjian').addEventListener('submit', function(e){
  e.preventDefault();
  const payload = {
    id: document.getElementById('editGuruUjianId').value || null,
    guru_id: document.getElementById('inGuruId').value,
    ujian_id: document.getElementById('inUjianId').value
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

// Staff account management and teacher password changes.
function loadDataAdminAkun() {
  const tb = document.getElementById('tblAdminAkun'); tb.innerHTML = `<tr><td colspan="6" align="center">Memuat...</td></tr>`;
  cbtApi
    .withSuccessHandler(rows => {
      if(!rows || rows.length===0) { tb.innerHTML=`<tr><td colspan="6" align="center">Tidak ada akun.</td></tr>`; return; }
      window.cacheAkunList = rows;
      window.cacheAkunExcel = rows.map(a => [a.username, a.nama_lengkap, a.password, a.role, a.status_aktif]);
      tb.innerHTML = rows.map(a => `
        <tr>
          <td><b>${a.username}</b></td>
          <td>${a.nama_lengkap || '-'}</td>
          <td><code style="background:var(--secondary-bg); padding:2px 6px; border-radius:4px; font-weight:700;">${a.password || '-'}</code></td>
          <td><span class="badge bg-gray">${a.role.toUpperCase()}</span></td>
          <td><span class="badge ${a.status_aktif?'bg-green':'bg-red'}">${a.status_aktif?'AKTIF':'NONAKTIF'}</span></td>
          <td><button class="btn btn-secondary" style="padding:4px 10px; font-size:11px;" onclick="editAkunById(${a.id})"><i class="fa-solid fa-pen"></i> Edit</button></td>
        </tr>`).join('');
    })
    .getAdminAkunList(stPengelola);
}

function editAkunById(id) {
  const a = (window.cacheAkunList || []).find(x => String(x.id) === String(id));
  if (a) editAkun(a);
}

function bukaModalAkun(data = null) {
  document.getElementById('formAkun').reset();
  if(data) {
    document.getElementById('titleModalAkun').textContent = "Edit Akun Pengelola";
    document.getElementById('editAkunId').value = data.id;
    document.getElementById('inAkunUsername').value = data.username;
    document.getElementById('inAkunNama').value = data.nama_lengkap || '';
    document.getElementById('inAkunPass').value = data.password || '';
    document.getElementById('inAkunRole').value = data.role;
    document.getElementById('inAkunStatus').value = String(data.status_aktif);
  } else {
    document.getElementById('titleModalAkun').textContent = "Tambah Akun Baru";
    document.getElementById('editAkunId').value = "";
  }
  document.getElementById('modalAkun').classList.add('show');
}
function editAkun(a) { bukaModalAkun(a); }

document.getElementById('formAkun').addEventListener('submit', function(e){
  e.preventDefault();
  const payload = {
    id: document.getElementById('editAkunId').value || null,
    username: document.getElementById('inAkunUsername').value,
    nama_lengkap: document.getElementById('inAkunNama').value,
    password: document.getElementById('inAkunPass').value,
    role: document.getElementById('inAkunRole').value,
    status_aktif: document.getElementById('inAkunStatus').value
  };
  showLoading('Menyimpan Akun...');
  cbtApi
    .withSuccessHandler(res => { 
      hideLoading(); 
      if(res.success){ 
        document.getElementById('modalAkun').classList.remove('show'); 
        loadDataAdminAkun(); 
      } else {
        showCustomAlert('Gagal', res.message);
      }
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .simpanAkunAdmin(stPengelola, payload);
});

function handleImportAkun(input) {
  handleExcelUpload(input, function(rows) {
    if (rows.length === 0) { showCustomAlert('Peringatan', 'File akun kosong.'); return; }
    showLoading('Mengimport akun...');
    cbtApi
      .withSuccessHandler(res => { hideLoading(); showCustomAlert('Informasi', res.message); loadDataAdminAkun(); input.value = ''; })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); input.value = ''; })
      .importAkunBulk(stPengelola, rows);
  });
}

function bukaModalProfilGuru() {
  document.getElementById('formUbahPassGuru').reset();
  document.getElementById('alertUbahPass').className = 'alert';
  document.getElementById('modalUbahPassGuru').classList.add('show');
}

document.getElementById('formUbahPassGuru').addEventListener('submit', function(e) {
  e.preventDefault();
  const pLama = document.getElementById('inPassLama').value;
  const pBaru = document.getElementById('inPassBaru').value;
  const alertEl = document.getElementById('alertUbahPass');
  
  showLoading('Menyimpan password baru...');
  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      if(res.success) {
        alertEl.className = 'alert info';
        alertEl.textContent = res.message;
        setTimeout(() => document.getElementById('modalUbahPassGuru').classList.remove('show'), 1500);
      } else {
        alertEl.className = 'alert error';
        alertEl.textContent = res.message;
      }
    })
    .withFailureHandler(err => { hideLoading(); alertEl.className = 'alert error'; alertEl.textContent = 'Error: ' + err.message; })
    .updatePasswordGuru(stPengelola, pLama, pBaru);
});

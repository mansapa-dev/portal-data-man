// Administrator student controls backed by Portal Data synchronization.
function loadDataAdminSiswa() {
  const tb = document.getElementById('tblAdminSiswa'); tb.innerHTML = `<tr><td colspan="7" align="center">Memuat data siswa...</td></tr>`;
  cbtApi
    .withSuccessHandler(rows => {
      if(!rows || rows.length===0) { tb.innerHTML=`<tr><td colspan="7" align="center">Tidak ada data siswa.</td></tr>`; return; }
      cacheSiswaGlobal = rows;
      window.cacheSiswaExcel = rows.map(s => [s.nomor_ujian, s.nama, s.kelas, s.tingkat, s.pin, s.tahun_ajaran || '', s.status_aktif]);
      tb.innerHTML = rows.map(s => {
        let bSt = s.ujian_status==='dihentikan'?'bg-red':'bg-gray';
        let actBtn = s.ujian_status==='dihentikan' ? `<button class="btn btn-success" style="padding:4px 8px; font-size:11px;" onclick="bukaBlokirAdmin(${s.id})"><i class="fa-solid fa-unlock"></i> Buka</button>` : `<span style="color:var(--text-muted); font-size:11px;">Normal</span>`;
        return `<tr>
          <td><b>${s.nomor_ujian}</b></td>
          <td>${s.nama}</td>
          <td>${s.kelas}</td>
          <td><span class="badge bg-gray">${s.tingkat}</span></td>
          <td><code style="background:var(--secondary-bg); padding:2px 6px; border-radius:4px; font-weight:700;">${s.pin}</code></td>
          <td><span class="badge ${bSt}">${(s.ujian_status||'belum').toUpperCase()}</span></td>
          <td style="display:flex; gap:6px;">
            ${actBtn}
            <button class="btn btn-primary" style="padding:4px 8px; font-size:11px;" onclick="generatePinAdmin(${s.id})"><i class="fa-solid fa-key"></i> Generate PIN</button>
          </td>
        </tr>`;
      }).join('');
    })
    .getAdminSiswaList(stPengelola);
}

function generatePinAdmin(id) {
  showLoading('Membuat PIN siswa...');
  cbtApi.withSuccessHandler(res => { hideLoading(); loadDataAdminSiswa(); showCustomAlert('PIN berhasil dibuat', `PIN siswa: ${res.pin}`); })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Gagal', err.message); })
    .simpanSiswaSatuanAdmin(stPengelola, { id, pin: '' });
}

function bukaModalSiswaSatuan(data = null) {
  document.getElementById('formSiswaSatuan').reset();
  if(data) {
    document.getElementById('titleModalSiswa').textContent = "Edit Data Siswa";
    document.getElementById('editSiswaId').value = data.id;
    document.getElementById('inSiswaNo').value = data.nomor_ujian;
    document.getElementById('inSiswaNama').value = data.nama;
    document.getElementById('inSiswaKelas').value = data.kelas;
    document.getElementById('inSiswaTingkat').value = data.tingkat;
    document.getElementById('inSiswaPin').value = data.pin;
    document.getElementById('inSiswaThn').value = data.tahun_ajaran || '2025/2026';
  } else {
    document.getElementById('titleModalSiswa').textContent = "Tambah Siswa / Manual";
    document.getElementById('editSiswaId').value = "";
  }
  document.getElementById('modalSiswaSatuan').classList.add('show');
}
function editSiswaSatuan(s) { bukaModalSiswaSatuan(s); }

document.getElementById('formSiswaSatuan').addEventListener('submit', function(e){
  e.preventDefault();
  const payload = {
    id: document.getElementById('editSiswaId').value || null,
    nomor_ujian: document.getElementById('inSiswaNo').value,
    nama: document.getElementById('inSiswaNama').value,
    kelas: document.getElementById('inSiswaKelas').value,
    tingkat: document.getElementById('inSiswaTingkat').value,
    pin: document.getElementById('inSiswaPin').value,
    tahun_ajaran: document.getElementById('inSiswaThn').value
  };
  showLoading('Menyimpan siswa...');
  cbtApi
    .withSuccessHandler(res => { 
      hideLoading(); 
      if(res.success){ 
        document.getElementById('modalSiswaSatuan').classList.remove('show'); 
        loadDataAdminSiswa(); 
      } else {
        showCustomAlert('Gagal', res.message);
      }
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .simpanSiswaSatuanAdmin(stPengelola, payload);
});

function hapusSiswaAdmin(id) {
  showCustomConfirm("Konfirmasi Hapus Siswa", "Yakin ingin menghapus siswa ini dari sistem?", () => {
    showLoading('Menghapus siswa...');
    cbtApi
      .withSuccessHandler(res => { 
        hideLoading(); 
        if(res.success) loadDataAdminSiswa(); 
        else showCustomAlert('Gagal', res.message);
      })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
      .hapusSiswaAdmin(stPengelola, id);
  });
}

function handleImportSiswa(input) {
  handleExcelUpload(input, function(rows) {
    if (rows.length === 0) { showCustomAlert('Peringatan', 'File Excel siswa kosong.'); return; }
    showLoading(`Mengimport ${rows.length} siswa ke server...`);
    cbtApi
      .withSuccessHandler(res => { hideLoading(); showCustomAlert('Informasi', res.message); loadDataAdminSiswa(); input.value = ''; })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Import Gagal', err.message); input.value = ''; })
      .importSiswaBulk(stPengelola, rows);
  });
}

function prosesKenaikanKelas() {
  showCustomConfirm("Kenaikan Kelas & Arsip Siswa XII", "Proses ini akan menaikkan kelas seluruh siswa (X ➔ XI, XI ➔ XII). Data siswa kelas XII akan didownload dulu ke Excel sebagai arsip, lalu dibersihkan dari sistem. Lanjutkan?", () => {
    showLoading('Memproses kenaikan kelas & mengunduh arsip kelas XII...');
    cbtApi
      .withSuccessHandler(res => { 
        hideLoading(); 
        if(res.success) {
          if (res.dataXII && res.dataXII.length > 0) {
            let headers = ['Nomor Ujian', 'Nama Siswa', 'Kelas', 'Tingkat', 'PIN', 'Tahun Ajaran'];
            let rows = res.dataXII.map(s => [s.nomor_ujian, s.nama, s.kelas, s.tingkat, s.pin, s.tahun_ajaran]);
            exportToExcel('arsip_kelulusan_kelas_XII.xlsx', 'Arsip Kelas XII', headers, rows);
          }
          showCustomAlert('Sukses', res.message);
          loadDataAdminSiswa(); 
        } else {
          showCustomAlert('Gagal', res.message);
        }
      })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
      .prosesKenaikanKelasAdmin(stPengelola);
  });
}

function bukaModalHapusPertingkat() {
  document.getElementById('modalHapusPertingkat').classList.add('show');
}

function eksekusiHapusPertingkat() {
  const t = document.getElementById('selectTingkatHapus').value;
  document.getElementById('modalHapusPertingkat').classList.remove('show');
  showCustomConfirm("Hapus Per Tingkat", `Yakin ingin menghapus seluruh siswa tingkat ${t}?`, () => {
    showLoading(`Menghapus siswa tingkat ${t}...`);
    cbtApi
      .withSuccessHandler(res => { 
        hideLoading(); 
        if(res.success) loadDataAdminSiswa(); 
        else showCustomAlert('Gagal', res.message);
      })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
      .hapusSiswaPertingkatAdmin(stPengelola, t);
  });
}

function bukaBlokirAdmin(id) {
  showCustomConfirm("Buka Blokir", "Buka blokir dan reset status ujian siswa ini?", () => {
    showLoading('Membuka akses...');
    cbtApi
      .withSuccessHandler(res => { 
        hideLoading(); 
        if(res.success) loadDataAdminSiswa(); 
        else showCustomAlert('Gagal', res.message);
      })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
      .adminBukaBlokirSiswa(stPengelola, id);
  });
}

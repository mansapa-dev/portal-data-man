// Administrator question bank management and imports.
function loadDataAdminSoal() {
  const tb = document.getElementById('tblAdminSoal'); tb.innerHTML = `<tr><td colspan="6" align="center">Memuat...</td></tr>`;
  cbtApi
    .withSuccessHandler(rows => {
      if(!rows || rows.length === 0) { tb.innerHTML = `<tr><td colspan="6" align="center">Belum ada soal.</td></tr>`; return; }
      window.cacheSoalExcel = rows.map(s => [s.id, s.ujian_id, s.pertanyaan, s.opsi_a, s.opsi_b, s.opsi_c, s.opsi_d, s.opsi_e, s.jawaban_benar, s.poin]);
      tb.innerHTML = rows.map(s => `
        <tr>
          <td>${s.id}</td>
          <td><b>${s.ujian_id}</b></td>
          <td>${s.pertanyaan.substring(0, 50)}...</td>
          <td><b style="color:var(--success);">${s.jawaban_benar}</b></td>
          <td>${s.poin}</td>
          <td><button class="btn btn-secondary" style="padding:4px 10px; font-size:11px;" onclick='editSoal(${JSON.stringify(s)})'><i class="fa-solid fa-pen"></i> Edit</button></td>
        </tr>`).join('');
    })
    .getAdminSoalList(stPengelola, null);
}

function bukaModalSoal(data = null) {
  document.getElementById('formSoal').reset();
  showLoading('Memuat daftar ujian...');
  cbtApi
    .withSuccessHandler(ujianList => {
      hideLoading();
      const sel = document.getElementById('inSoalUjianId');
      sel.innerHTML = ujianList.map(u => `<option value="${u.id}">${u.nama_ujian} (${u.tahun_ajaran || '2025/2026'} - ${u.semester || 'Genap'})</option>`).join('');
      
      if(data) {
        document.getElementById('titleModalSoal').textContent = "Edit Soal";
        document.getElementById('editSoalId').value = data.id;
        sel.value = data.ujian_id;
        document.getElementById('inPertanyaan').value = data.pertanyaan;
        document.getElementById('inOpsiA').value = data.opsi_a;
        document.getElementById('inOpsiB').value = data.opsi_b;
        document.getElementById('inOpsiC').value = data.opsi_c;
        document.getElementById('inOpsiD').value = data.opsi_d;
        document.getElementById('inOpsiE').value = data.opsi_e || '';
        document.getElementById('inJawabanBenar').value = data.jawaban_benar;
        document.getElementById('inPoinSoal').value = data.poin || 1;
      } else {
        document.getElementById('titleModalSoal').textContent = "Tambah Soal Baru";
        document.getElementById('editSoalId').value = "";
      }
      document.getElementById('modalSoal').classList.add('show');
    })
    .getAdminUjianList(stPengelola);
}
function editSoal(s) { bukaModalSoal(s); }

document.getElementById('formSoal').addEventListener('submit', function(e){
  e.preventDefault();
  const payload = {
    id: document.getElementById('editSoalId').value || null,
    ujian_id: document.getElementById('inSoalUjianId').value,
    pertanyaan: document.getElementById('inPertanyaan').value,
    opsi_a: document.getElementById('inOpsiA').value,
    opsi_b: document.getElementById('inOpsiB').value,
    opsi_c: document.getElementById('inOpsiC').value,
    opsi_d: document.getElementById('inOpsiD').value,
    opsi_e: document.getElementById('inOpsiE').value,
    jawaban_benar: document.getElementById('inJawabanBenar').value,
    poin: document.getElementById('inPoinSoal').value
  };
  showLoading('Menyimpan Soal...');
  cbtApi
    .withSuccessHandler(res => { 
      hideLoading(); 
      if(res.success){ 
        document.getElementById('modalSoal').classList.remove('show'); 
        loadDataAdminSoal(); 
      } else {
        showCustomAlert('Gagal', res.message);
      }
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .simpanSoalAdmin(stPengelola, payload);
});

function handleImportSoal(input) {
  handleExcelUpload(input, function(rows) {
    if (rows.length === 0) { showCustomAlert('Peringatan', 'File Excel soal kosong atau tidak valid.'); return; }
    showLoading('Mengimport soal berulang per mapel...');
    cbtApi
      .withSuccessHandler(res => { hideLoading(); showCustomAlert('Informasi', res.message); loadDataAdminSoal(); input.value = ''; })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Import Gagal', err.message); input.value = ''; })
      .importSoalBulk(stPengelola, rows);
  });
}

// Violation logs, result filtering, reports, and participant card printing.
function loadDataAdminLogPelanggaran() {
  const tb = document.getElementById('tblAdminLogPelanggaran'); tb.innerHTML = `<tr><td colspan="7" align="center">Memuat...</td></tr>`;
  cbtApi
    .withSuccessHandler(res => {
      if(!res.success || !res.data || res.data.length === 0) {
        tb.innerHTML = `<tr><td colspan="7" align="center">Tidak ada catatan pelanggaran.</td></tr>`;
        window.cachePelanggaranExcel = [];
        return;
      }
      window.cachePelanggaranExcel = res.data.map(p => [p.nomor_ujian, p.nama_siswa, p.kelas, p.nama_ujian, p.jumlah_pelanggaran, p.keterangan, p.waktu]);
      tb.innerHTML = res.data.map(p => `
        <tr>
          <td><small>${p.waktu}</small></td>
          <td><b>${p.nomor_ujian}</b></td>
          <td>${p.nama_siswa}</td>
          <td>${p.kelas}</td>
          <td>${p.nama_ujian}</td>
          <td><span class="badge bg-red">${p.jumlah_pelanggaran} Kali</span></td>
          <td>${p.keterangan}</td>
        </tr>
      `).join('');
    })
    .getAdminLogPelanggaran(stPengelola);
}

function loadDataAdminHasil() {
  showLoading('Memuat rekap hasil...');
  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      if(!res.success || !res.data) { showCustomAlert('Gagal', res.message); return; }
      
      cacheHasilRaw = res.data;
      const selThn = document.getElementById('fltTahunAjaran');
      const selUjian = document.getElementById('fltHasilUjian');
      const selKelas = document.getElementById('fltHasilKelas');
      
      const setThn = new Set(), setUjian = new Set(), setKelas = new Set();
      cacheHasilRaw.forEach(h => {
        if(h.tahun_ajaran) setThn.add(h.tahun_ajaran);
        if(h.nama_ujian) setUjian.add(h.nama_ujian);
        if(h.kelas) setKelas.add(h.kelas);
      });
      
      selThn.innerHTML = '<option value="ALL">Semua Tahun</option>' + Array.from(setThn).map(t=>`<option value="${t}">${t}</option>`).join('');
      selUjian.innerHTML = '<option value="ALL">Semua Ujian</option>' + Array.from(setUjian).map(u=>`<option value="${u}">${u}</option>`).join('');
      selKelas.innerHTML = '<option value="ALL">Semua Rombel</option>' + Array.from(setKelas).map(k=>`<option value="${k}">${k}</option>`).join('');
      
      applyFilterHasil();
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .getAdminHasilGlobal(stPengelola);
}

function applyFilterHasil() {
  const fThn = document.getElementById('fltTahunAjaran').value;
  const fSem = document.getElementById('fltSemester').value;
  const fTingkat = document.getElementById('fltHasilTingkat').value;
  const fKelas = document.getElementById('fltHasilKelas').value;
  const fUjian = document.getElementById('fltHasilUjian').value;
  
  const filtered = cacheHasilRaw.filter(h => {
    let matchThn = fThn === 'ALL' || h.tahun_ajaran === fThn;
    let matchSem = fSem === 'ALL' || h.semester === fSem;
    let matchTingkat = fTingkat === 'ALL' || h.tingkat === fTingkat;
    let matchK = fKelas === 'ALL' || h.kelas === fKelas;
    let matchU = fUjian === 'ALL' || h.nama_ujian === fUjian;
    return matchThn && matchSem && matchTingkat && matchK && matchU;
  });
  
  const tb = document.getElementById('tblAdminHasil');
  if(filtered.length === 0) { tb.innerHTML = `<tr><td colspan="7" align="center">Data tidak ditemukan.</td></tr>`; return; }
  
  tb.innerHTML = filtered.map(h => `
    <tr>
      <td><b>${h.nomor_ujian}</b></td>
      <td>${h.nama_siswa}</td>
      <td><span class="badge bg-gray">${h.tingkat || '-'}</span></td>
      <td>${h.kelas}</td>
      <td>${h.nama_ujian}</td>
      <td><b style="color:var(--primary); font-size:14px;">${h.nilai}</b></td>
      <td><span class="badge bg-green">${h.status.toUpperCase()}</span></td>
    </tr>
  `).join('');
}

function exportFilterHasil(type) {
  const fThn = document.getElementById('fltTahunAjaran').value;
  const fSem = document.getElementById('fltSemester').value;
  const fTingkat = document.getElementById('fltHasilTingkat').value;
  const fKelas = document.getElementById('fltHasilKelas').value;
  const fUjian = document.getElementById('fltHasilUjian').value;
  
  const filtered = cacheHasilRaw.filter(h => {
    let matchThn = fThn === 'ALL' || h.tahun_ajaran === fThn;
    let matchSem = fSem === 'ALL' || h.semester === fSem;
    let matchTingkat = fTingkat === 'ALL' || h.tingkat === fTingkat;
    let matchK = fKelas === 'ALL' || h.kelas === fKelas;
    let matchU = fUjian === 'ALL' || h.nama_ujian === fUjian;
    return matchThn && matchSem && matchTingkat && matchK && matchU;
  });

  if(filtered.length === 0) { showCustomAlert('Peringatan', 'Tidak ada data yang sesuai filter untuk diexport.'); return; }
  
  if(type === 'ujian') {
    let headers = ['Nama Ujian', 'Nomor Peserta', 'Nama Siswa', 'Tingkat', 'Kelas', 'Tahun Ajaran', 'Semester', 'Nilai Akhir', 'Status'];
    let rows = filtered.map(h => [h.nama_ujian, h.nomor_ujian, h.nama_siswa, h.tingkat, h.kelas, h.tahun_ajaran, h.semester, h.nilai, h.status]);
    exportToExcel('rekap_rekapitulasi_ujian.xlsx', 'Rekap Ujian', headers, rows);
  } else if(type === 'rombel') {
    let headers = ['Tingkat', 'Kelas/Rombel', 'Nama Ujian', 'Nomor Peserta', 'Nama Siswa', 'Nilai Akhir', 'Status'];
    let rows = filtered.map(h => [h.tingkat, h.kelas, h.nama_ujian, h.nomor_ujian, h.nama_siswa, h.nilai, h.status]);
    exportToExcel('rekap_per_rombel.xlsx', 'Per Rombel', headers, rows);
  }
}

function cetakLaporanResmiPDF() {
  const fThn = document.getElementById('fltTahunAjaran').value;
  const fSem = document.getElementById('fltSemester').value;
  const fTingkat = document.getElementById('fltHasilTingkat').value;
  const fKelas = document.getElementById('fltHasilKelas').value;
  const fUjian = document.getElementById('fltHasilUjian').value;
  
  const filtered = cacheHasilRaw.filter(h => {
    let matchThn = fThn === 'ALL' || h.tahun_ajaran === fThn;
    let matchSem = fSem === 'ALL' || h.semester === fSem;
    let matchTingkat = fTingkat === 'ALL' || h.tingkat === fTingkat;
    let matchK = fKelas === 'ALL' || h.kelas === fKelas;
    let matchU = fUjian === 'ALL' || h.nama_ujian === fUjian;
    return matchThn && matchSem && matchTingkat && matchK && matchU;
  });

  if(filtered.length === 0) { showCustomAlert('Peringatan', 'Tidak ada data sesuai filter untuk dicetak.'); return; }
  
  document.getElementById('printKop1').textContent = document.getElementById('kopBaris1').value;
  document.getElementById('printKop2').textContent = document.getElementById('kopBaris2').value;
  document.getElementById('printKop3').textContent = document.getElementById('kopBaris3').value;
  document.getElementById('printKop4').textContent = document.getElementById('kopBaris4').value;

  const valKepsek = document.getElementById('inputKepsek').value.trim() || '.............................................';
  const valNipKepsek = document.getElementById('inputNipKepsek').value.trim() || '.............................................';
  const valWakur = document.getElementById('inputWakur').value.trim() || '.............................................';
  const valNipWakur = document.getElementById('inputNipWakur').value.trim() || '.............................................';
  
  document.getElementById('lblPrintKepsek').innerHTML = `<u>${valKepsek}</u>`;
  document.getElementById('lblPrintNipKepsek').textContent = valNipKepsek;
  document.getElementById('lblPrintWakur').innerHTML = `<u>${valWakur}</u>`;
  document.getElementById('lblPrintNipWakur').textContent = valNipWakur;
  
  let html = `<table style="width:100%; border-collapse:collapse; font-size:11px;" border="1" cellpadding="6">
    <thead>
      <tr style="background:#f1f5f9;">
        <th>No</th><th>No Peserta</th><th>Nama Siswa</th><th>Tingkat</th><th>Kelas</th><th>Mata Ujian</th><th>Nilai</th><th>Status</th>
      </tr>
    </thead>
    <tbody>`;
  
  filtered.forEach((h, idx) => {
    html += `<tr>
      <td align="center">${idx + 1}</td>
      <td><b>${h.nomor_ujian}</b></td>
      <td>${h.nama_siswa}</td>
      <td align="center">${h.tingkat || '-'}</td>
      <td>${h.kelas}</td>
      <td>${h.nama_ujian}</td>
      <td align="center"><b>${h.nilai}</b></td>
      <td align="center">${h.status.toUpperCase()}</td>
    </tr>`;
  });
  
  html += `</tbody></table>`;
  document.getElementById('printContentTable').innerHTML = html;
  
  // Aktifkan mode cetak laporan khusus
  document.body.className = "mode-cetak-laporan";
  window.print();
  document.body.className = "";
}

function loadDataAdminKartu() {
  const container = document.getElementById('printAreaCards');
  const printContainer = document.getElementById('printAreaKartuContainer');
  container.innerHTML = `<div class="alert info">Memuat kartu peserta...</div>`;
  
  const fTingkat = document.getElementById('filterKartuTingkat').value;
  const fKelas = document.getElementById('filterKartuKelas').value.toLowerCase().trim();

  cbtApi
    .withSuccessHandler(rows => {
      if(!rows || rows.length === 0) { 
        container.innerHTML = `<div class="alert error">Tidak ada data siswa.</div>`; 
        printContainer.innerHTML = '';
        return; 
      }
      
      const filtered = rows.filter(s => {
        let matchT = fTingkat === 'ALL' || String(s.tingkat).toUpperCase() === fTingkat;
        let matchK = !fKelas || String(s.kelas).toLowerCase().includes(fKelas);
        return matchT && matchK;
      });

      if(filtered.length === 0) {
        container.innerHTML = `<div class="alert error">Tidak ada siswa yang cocok dengan filter tingkat/kelas tersebut.</div>`;
        printContainer.innerHTML = '';
        return;
      }

      const cardsHtml = filtered.map(s => `
        <div class="card-ujian-print" style="border: 2px solid var(--border); padding: 14px; border-radius: 10px; background: white; margin-bottom: 12px;">
          <div class="card-print-letterhead" style="display:flex; align-items:center; gap:8px; border-bottom:2px solid var(--primary); padding-bottom:6px; margin-bottom:10px;">
            <img src="assets/img/logo-man1-palembang.png" alt="Lambang MAN 1 Palembang" style="width:34px; height:34px; object-fit:contain;">
            <div style="flex:1;"><b style="display:block; font-size:12px; color:var(--primary);">KARTU PESERTA UJIAN</b><span style="font-size:10px; font-weight:700;">MADRASAH ALIYAH NEGERI 1 PALEMBANG</span></div>
          </div>
          <table style="font-size:11px; width:100%;">
            <tr><td style="padding:3px; width:35%;">No Peserta</td><td style="padding:3px;">: <b>${s.nomor_ujian}</b></td></tr>
            <tr><td style="padding:3px;">Nama Siswa</td><td style="padding:3px;">: <b>${s.nama}</b></td></tr>
            <tr><td style="padding:3px;">Kelas / Tingkat</td><td style="padding:3px;">: ${s.kelas} / ${s.tingkat}</td></tr>
            <tr><td style="padding:3px;">PIN Ujian</td><td style="padding:3px;"><span class="badge bg-gray" style="font-size:12px; font-weight:900; letter-spacing:1px;">${s.pin}</span></td></tr>
          </table>
        </div>
      `).join('');

      container.innerHTML = cardsHtml;
      printContainer.innerHTML = cardsHtml;
    })
    .getAdminSiswaList(stPengelola);
}

function cetakKartuPesertaUjian() {
  document.body.className = "mode-cetak-kartu";
  window.print();
  document.body.className = "";
}

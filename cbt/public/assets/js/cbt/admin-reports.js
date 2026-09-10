// Violation logs, result filtering, reports, and participant card printing.
let cachePelanggaranRaw=[];
function loadDataAdminLogPelanggaran() {
  const tb = document.getElementById('tblAdminLogPelanggaran'); tb.innerHTML = `<tr><td colspan="7" align="center">Memuat...</td></tr>`;
  cbtApi
    .withSuccessHandler(res => {
      if(!res.success || !res.data || res.data.length === 0) {
        tb.innerHTML = `<tr><td colspan="7" align="center">Tidak ada catatan pelanggaran.</td></tr>`;
        cachePelanggaranRaw=[];window.cachePelanggaranExcel = [];
        return;
      }
      cachePelanggaranRaw=res.data;populatePelanggaranFilters();applyFilterPelanggaran();
    })
    .getAdminLogPelanggaran(stPengelola);
}

function populatePelanggaranFilters(){const option=(id,label,values)=>{const el=document.getElementById(id),current=el.value,items=[...new Set(values.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'id',{numeric:true}));el.innerHTML=`<option value="ALL">${label} (${items.length})</option>`+items.map(x=>`<option value="${x}">${x}</option>`).join('');el.value=items.includes(current)?current:'ALL';};option('fltPelanggaranTingkat','Semua Tingkat',cachePelanggaranRaw.map(p=>p.tingkat));option('fltPelanggaranKelas','Semua Kelas',cachePelanggaranRaw.map(p=>p.kelas));option('fltPelanggaranUjian','Semua Ujian / Mapel',cachePelanggaranRaw.map(p=>p.nama_ujian));option('fltPelanggaranJenis','Semua Jenis Pelanggaran',cachePelanggaranRaw.map(p=>p.keterangan));}

function applyFilterPelanggaran(){const date=document.getElementById('fltPelanggaranTanggal').value,grade=document.getElementById('fltPelanggaranTingkat').value,kelas=document.getElementById('fltPelanggaranKelas').value,ujian=document.getElementById('fltPelanggaranUjian').value,jenis=document.getElementById('fltPelanggaranJenis').value,query=document.getElementById('searchPelanggaran').value.trim().toLowerCase();const rows=cachePelanggaranRaw.filter(p=>(!date||String(p.waktu||'').slice(0,10)===date)&&(grade==='ALL'||String(p.tingkat)===grade)&&(kelas==='ALL'||p.kelas===kelas)&&(ujian==='ALL'||p.nama_ujian===ujian)&&(jenis==='ALL'||p.keterangan===jenis)&&(!query||`${p.nomor_ujian||''} ${p.nama_siswa||''} ${p.kelas||''} ${p.nama_ujian||''} ${p.keterangan||''}`.toLowerCase().includes(query)));window.cachePelanggaranExcel=rows.map(p=>[p.nomor_ujian,p.nama_siswa,p.kelas,p.nama_ujian,p.jumlah_pelanggaran,p.keterangan,p.waktu]);const tb=document.getElementById('tblAdminLogPelanggaran');tb.innerHTML=rows.length?rows.map(p=>`
        <tr>
          <td><small>${p.waktu}</small></td>
          <td><b>${p.nomor_ujian}</b></td>
          <td>${p.nama_siswa}</td>
          <td>${p.kelas}</td>
          <td>${p.nama_ujian}</td>
          <td><span class="badge bg-red">${p.jumlah_pelanggaran} Kali</span></td>
          <td>${p.keterangan}${p.attempt_status === 'TERMINATED' && Number(p.jumlah_pelanggaran) >= 3 ? `<br><button class="btn btn-warning" onclick="resetCbtAttempt(${Number(p.student_id)},${Number(p.exam_id)})"><i class="fa-solid fa-unlock"></i> Reset CBT</button>` : ''}</td>
        </tr>
      `).join(''):`<tr><td colspan="7" align="center">Tidak ada data sesuai filter.</td></tr>`;}

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

const urutkanHasilAbjad = rows => [...rows].sort((a,b) => String(a.nama_siswa || '').localeCompare(String(b.nama_siswa || ''),'id',{sensitivity:'base',numeric:true}) || String(a.nomor_ujian || '').localeCompare(String(b.nomor_ujian || ''),'id',{numeric:true}));
const formatWaktuSelesai = value => value ? new Date(String(value).replace(' ','T').replace(/Z?$/,'Z')).toLocaleString('id-ID',{timeZone:'Asia/Jakarta',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '-';

function applyFilterHasil() {
  const fThn = document.getElementById('fltTahunAjaran').value;
  const fSem = document.getElementById('fltSemester').value;
  const fTingkat = document.getElementById('fltHasilTingkat').value;
  const fKelas = document.getElementById('fltHasilKelas').value;
  const fUjian = document.getElementById('fltHasilUjian').value;
  
  const filtered = urutkanHasilAbjad(cacheHasilRaw.filter(h => {
    let matchThn = fThn === 'ALL' || h.tahun_ajaran === fThn;
    let matchSem = fSem === 'ALL' || h.semester === fSem;
    let matchTingkat = fTingkat === 'ALL' || h.tingkat === fTingkat;
    let matchK = fKelas === 'ALL' || h.kelas === fKelas;
    let matchU = fUjian === 'ALL' || h.nama_ujian === fUjian;
    return matchThn && matchSem && matchTingkat && matchK && matchU;
  }));
  
  const tb = document.getElementById('tblAdminHasil');
  if(filtered.length === 0) { tb.innerHTML = `<tr><td colspan="8" class="text-center">Data tidak ditemukan.</td></tr>`; return; }
  
  tb.innerHTML = filtered.map(h => `
    <tr>
      <td><b>${h.nomor_ujian}</b></td>
      <td>${h.nama_siswa}</td>
      <td><span class="badge bg-gray">${h.tingkat || '-'}</span></td>
      <td>${h.kelas}</td>
      <td>${h.nama_ujian}</td>
      <td><b style="color:var(--primary); font-size:14px;">${h.nilai}</b></td>
      <td><span class="badge bg-green">${h.status.toUpperCase()}</span></td>
      <td><small>${formatWaktuSelesai(h.waktu_selesai)}</small></td>
    </tr>
  `).join('');
}

function exportFilterHasil(type) {
  const fThn = document.getElementById('fltTahunAjaran').value;
  const fSem = document.getElementById('fltSemester').value;
  const fTingkat = document.getElementById('fltHasilTingkat').value;
  const fKelas = document.getElementById('fltHasilKelas').value;
  const fUjian = document.getElementById('fltHasilUjian').value;
  
  const filtered = urutkanHasilAbjad(cacheHasilRaw.filter(h => {
    let matchThn = fThn === 'ALL' || h.tahun_ajaran === fThn;
    let matchSem = fSem === 'ALL' || h.semester === fSem;
    let matchTingkat = fTingkat === 'ALL' || h.tingkat === fTingkat;
    let matchK = fKelas === 'ALL' || h.kelas === fKelas;
    let matchU = fUjian === 'ALL' || h.nama_ujian === fUjian;
    return matchThn && matchSem && matchTingkat && matchK && matchU;
  }));

  if(filtered.length === 0) { showCustomAlert('Peringatan', 'Tidak ada data yang sesuai filter untuk diexport.'); return; }
  
  if(type === 'ujian') {
    let headers = ['Nama Ujian', 'Nomor Peserta', 'Nama Siswa', 'Tingkat', 'Kelas', 'Tahun Ajaran', 'Semester', 'Nilai Akhir', 'Status', 'Waktu Selesai'];
    let rows = filtered.map(h => [h.nama_ujian, h.nomor_ujian, h.nama_siswa, h.tingkat, h.kelas, h.tahun_ajaran, h.semester, h.nilai, h.status, formatWaktuSelesai(h.waktu_selesai)]);
    exportToExcel('rekap_rekapitulasi_ujian.xlsx', 'Rekap Ujian', headers, rows);
  } else if(type === 'rombel') {
    let headers = ['Tingkat', 'Kelas/Rombel', 'Nama Ujian', 'Nomor Peserta', 'Nama Siswa', 'Nilai Akhir', 'Status', 'Waktu Selesai'];
    let rows = filtered.map(h => [h.tingkat, h.kelas, h.nama_ujian, h.nomor_ujian, h.nama_siswa, h.nilai, h.status, formatWaktuSelesai(h.waktu_selesai)]);
    exportToExcel('rekap_per_rombel.xlsx', 'Per Rombel', headers, rows);
  }
}

function cetakLaporanResmiPDF() {
  const fThn = document.getElementById('fltTahunAjaran').value;
  const fSem = document.getElementById('fltSemester').value;
  const fTingkat = document.getElementById('fltHasilTingkat').value;
  const fKelas = document.getElementById('fltHasilKelas').value;
  const fUjian = document.getElementById('fltHasilUjian').value;
  
  const filtered = urutkanHasilAbjad(cacheHasilRaw.filter(h => {
    let matchThn = fThn === 'ALL' || h.tahun_ajaran === fThn;
    let matchSem = fSem === 'ALL' || h.semester === fSem;
    let matchTingkat = fTingkat === 'ALL' || h.tingkat === fTingkat;
    let matchK = fKelas === 'ALL' || h.kelas === fKelas;
    let matchU = fUjian === 'ALL' || h.nama_ujian === fUjian;
    return matchThn && matchSem && matchTingkat && matchK && matchU;
  }));

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
  
  let html = `<table class="print-results-table" style="width:100%; border-collapse:collapse; table-layout:fixed; font-size:9px;" border="1" cellpadding="5">
    <thead>
      <tr style="background:#f1f5f9;">
        <th style="width:4%">No</th><th style="width:12%">No Peserta</th><th style="width:20%">Nama Siswa</th><th style="width:7%">Tingkat</th><th style="width:10%">Kelas</th><th style="width:19%">Mata Ujian</th><th style="width:7%">Nilai</th><th style="width:9%">Status</th><th style="width:12%">Waktu Selesai</th>
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
      <td align="center">${formatWaktuSelesai(h.waktu_selesai)}</td>
    </tr>`;
  });
  
  html += `</tbody></table>`;
  document.getElementById('printContentTable').innerHTML = html;
  
  // Aktifkan mode cetak laporan khusus
  document.body.className = "mode-cetak-laporan";
  window.print();
  document.body.className = "";
}

function renderDataAdminKartu(rows) {
  const container = document.getElementById('printAreaCards');
  container.className = '';
  const printContainer = document.getElementById('printAreaKartuContainer');
  const summary = document.getElementById('cardPrintSummary');
  const printButton = document.getElementById('btnCetakKartu');
  const fTingkat = document.getElementById('filterKartuTingkat').value;
  const fKelas = document.getElementById('filterKartuKelas').value.toLowerCase().trim();
  const eligible=(Array.isArray(rows)?rows:[]).filter(s=>(fTingkat==='ALL'||String(s.tingkat).toUpperCase()===fTingkat)&&(!fKelas||String(s.kelas).toLowerCase()===fKelas));
  const ready=eligible.filter(s=>s.pin&&!['BELUM DISET','PERLU DIGANTI'].includes(s.pin));
  const skipped=eligible.length-ready.length;
  if(!eligible.length){container.innerHTML=`<div class="alert error">Tidak ada siswa yang cocok dengan filter tingkat/kelas tersebut.</div>`;printContainer.innerHTML='';summary.textContent='0 kartu siap dicetak.';printButton.disabled=true;return;}
  const safe=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const cardsHtml=ready.map(s => `
        <div class="card-ujian-print" style="border: 2px solid var(--border); padding: 14px; border-radius: 10px; background: white; margin-bottom: 12px;">
          <div class="card-print-letterhead" style="display:flex; align-items:center; gap:8px; border-bottom:2px solid var(--primary); padding-bottom:6px; margin-bottom:10px;">
            <img src="assets/img/logo-man1-palembang.png" alt="Lambang MAN 1 Palembang" style="width:34px; height:34px; object-fit:contain;">
            <div style="flex:1;"><b style="display:block; font-size:12px; color:var(--primary);">KARTU PESERTA UJIAN</b><span style="font-size:10px; font-weight:700;">MADRASAH ALIYAH NEGERI 1 PALEMBANG</span></div>
          </div>
          <table style="font-size:11px; width:100%;">
            <tr><td style="padding:3px; width:35%;">No Peserta</td><td style="padding:3px;">: <b>${safe(s.nomor_ujian)}</b></td></tr>
            <tr><td style="padding:3px;">Nama Siswa</td><td style="padding:3px;">: <b>${safe(s.nama)}</b></td></tr>
            <tr><td style="padding:3px;">Kelas / Tingkat</td><td style="padding:3px;">: ${safe(s.kelas)} / ${safe(s.tingkat)}</td></tr>
            <tr><td style="padding:3px;">PIN Ujian</td><td style="padding:3px;"><span class="badge bg-gray" style="font-size:12px; font-weight:900; letter-spacing:1px;">${safe(s.pin)}</span></td></tr>
          </table>
        </div>
      `).join('');
  container.innerHTML=cardsHtml||`<div class="alert error">Tidak ada kartu dengan PIN yang siap dicetak.</div>`;
  printContainer.innerHTML=cardsHtml;
  summary.textContent=`${ready.length} kartu siap dicetak${skipped?`; ${skipped} siswa dilewati karena PIN belum tersedia`:''}. Data tersinkron dengan Seluruh Data Siswa.`;
  printButton.disabled=ready.length===0;
}

function loadDataAdminKartu(force=false) {
  const container=document.getElementById('printAreaCards');
  if(!force&&Array.isArray(cacheSiswaGlobal)&&cacheSiswaGlobal.length){renderDataAdminKartu(cacheSiswaGlobal);return;}
  container.innerHTML=`<div class="alert info">Menyinkronkan data kartu dengan Seluruh Data Siswa...</div>`;
  document.getElementById('btnCetakKartu').disabled=true;
  cbtApi.withSuccessHandler(rows=>{cacheSiswaGlobal=Array.isArray(rows)?rows:[];renderDataAdminKartu(cacheSiswaGlobal);}).withFailureHandler(()=>{container.textContent='Gagal menyinkronkan data kartu siswa.';container.className='alert error';document.getElementById('printAreaKartuContainer').innerHTML='';}).getAdminSiswaList(stPengelola);
}

function cetakKartuPesertaUjian() {
  if(!document.getElementById('printAreaKartuContainer').children.length)return showCustomAlert('Kartu Belum Siap','Sinkronkan data dan pastikan siswa sudah memiliki PIN.','warning');
  document.body.classList.add('mode-cetak-kartu');
  window.print();
  document.body.classList.remove('mode-cetak-kartu');
}

window.addEventListener('cbt:data-updated',event=>{if(String(event.detail?.path||'').includes('/students'))cacheSiswaGlobal=[];});

function resetCbtAttempt(studentId, examId) {
  const reason = window.prompt('Alasan reset CBT: jawaban tetap tersimpan, hitungan pelanggaran kembali nol, dan sisa waktu dipulihkan meskipun jadwal sudah berakhir.');
  if (!reason?.trim()) return;
  showLoading('Membuka kembali CBT...');
  cbtApi.withSuccessHandler(() => {
    hideLoading(); loadDataAdminLogPelanggaran();
    if (typeof loadDataAdminSiswa === 'function') loadDataAdminSiswa();
    showCustomAlert('CBT Dibuka', 'Siswa dapat kembali ke dashboard dan melanjutkan ujian. Jawaban sebelumnya tetap tersimpan.', 'success');
  }).withFailureHandler(error => { hideLoading(); showCustomAlert('Reset Gagal', error.message, 'error'); })
    .adminBukaBlokirSiswa(stPengelola, studentId, examId, reason.trim());
}

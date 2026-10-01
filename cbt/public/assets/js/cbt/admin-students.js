// Administrator student controls backed by Portal Data synchronization and batch PIN generation.

let adminStudentLoadInFlight = false, adminStudentReloadQueued = false, adminStudentPage = 1, adminStudentMeta = {page:1,pages:1,total:0}, adminStudentSearchTimer;
function loadDataAdminSiswa(resetPage = true) {
  if(resetPage) adminStudentPage=1;
  if (adminStudentLoadInFlight) { adminStudentReloadQueued = true; return; }
  adminStudentLoadInFlight = true;
  const tb = document.getElementById('tblAdminSiswa');
  if (tb) tb.innerHTML = `<tr><td colspan="8" align="center" style="padding:24px;">Memuat data peserta ujian...</td></tr>`;

  loadPortalReferences(() => {
    populateAdminSiswaFilters();
  });

  cbtApi
    .withSuccessHandler(rows => {
      adminStudentLoadInFlight = false;
      cacheSiswaGlobal = Array.isArray(rows) ? rows : (rows?.items || []);
      adminStudentMeta = rows?.meta || {page:1,limit:25,pages:1,total:cacheSiswaGlobal.length};
      populateAdminSiswaFilters();
      renderAdminSiswaPage();
      if (adminStudentReloadQueued) { adminStudentReloadQueued = false; setTimeout(loadDataAdminSiswa, 0); }
    })
    .withFailureHandler(err => {
      adminStudentLoadInFlight = false;
      const message = err?.code === 'REQUEST_TIMEOUT' || err?.status === 408 ? 'Data siswa belum selesai dalam 20 detik. Silakan tekan Coba Lagi.' : (err?.message || 'Permintaan gagal.');
      if (tb) tb.innerHTML = `<tr><td colspan="8" align="center" style="padding:28px; color:var(--danger);"><i class="fa-solid fa-triangle-exclamation" style="display:block;font-size:24px;margin-bottom:8px"></i><b>Data siswa belum dapat dimuat</b><div style="margin:6px 0 12px;color:var(--text-muted)">${message}</div><button type="button" class="btn btn-secondary" onclick="loadDataAdminSiswa()"><i class="fa-solid fa-rotate"></i> Coba Lagi</button></td></tr>`;
      if (adminStudentReloadQueued) adminStudentReloadQueued = false;
    })
    .getAdminSiswaList(stPengelola,{page:adminStudentPage,limit:25,grade:document.getElementById('fltSiswaTingkat')?.value||'ALL',class_name:document.getElementById('fltSiswaKelas')?.value||'ALL',status:document.getElementById('fltSiswaStatus')?.value||'ALL',sort:document.getElementById('fltSiswaSort')?.value||'nama_asc',search:document.getElementById('searchSiswa')?.value?.trim()||''});
}

function populateAdminSiswaFilters() {
  const tingVal = document.getElementById('fltSiswaTingkat')?.value || 'ALL';
  const fltKelas = document.getElementById('fltSiswaKelas');
  if (!fltKelas) return;

  const currentVal = fltKelas.value;
  const classSet = new Set();

  // 1. From portalReferences
  if (portalReferences && Array.isArray(portalReferences.classes)) {
    portalReferences.classes.forEach(c => {
      if (tingVal === 'ALL' || String(c.grade || '').toUpperCase() === tingVal.toUpperCase()) {
        const name = c.name || c.code;
        if (name) classSet.add(name);
      }
    });
  }

  // 2. From cacheSiswaGlobal
  if (cacheSiswaGlobal && Array.isArray(cacheSiswaGlobal)) {
    cacheSiswaGlobal.forEach(s => {
      if (tingVal === 'ALL' || String(s.tingkat || '').toUpperCase() === tingVal.toUpperCase()) {
        if (s.kelas) classSet.add(s.kelas);
      }
    });
  }

  const sortedClasses = Array.from(classSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  fltKelas.innerHTML = `<option value="ALL">Semua Kelas (${sortedClasses.length})</option>` + sortedClasses.map(c => `
    <option value="${c}">${c}</option>
  `).join('');

  if (currentVal && sortedClasses.includes(currentVal)) {
    fltKelas.value = currentVal;
  } else {
    fltKelas.value = 'ALL';
  }
}

function renderAdminSiswaPage() {
  const filtered = cacheSiswaGlobal || [];

  // 2. Update Excel Cache
  window.cacheSiswaExcel = filtered.map(s => [
    s.nomor_ujian || s.nisn,
    s.nama,
    s.kelas,
    s.tingkat,
    s.pin,
    s.tahun_ajaran || '2025/2026',
    (s.ujian_status || 'belum').toUpperCase()
  ]);

  // 3. Render table
  renderTabelSiswa(filtered);
}

function applyFilterSiswa(){clearTimeout(adminStudentSearchTimer);adminStudentSearchTimer=setTimeout(()=>{adminStudentPage=1;loadDataAdminSiswa(false);},250);}

function renderTabelSiswa(rows) {
  const tb = document.getElementById('tblAdminSiswa');
  if (!tb) return;

  if (!rows || rows.length === 0) {
    tb.innerHTML = `
      <tr>
        <td colspan="8" align="center" style="padding:32px; color:var(--text-muted);">
          <i class="fa-solid fa-users-slash" style="font-size:32px; color:var(--text-muted); margin-bottom:10px; display:block;"></i>
          <div style="font-weight:700; font-size:14px; color:var(--text-main);">Tidak Ada Data Siswa yang Sesuai</div>
          <p style="font-size:12px; margin-top:4px;">Silakan sesuaikan filter tingkat, kelas, status, atau pencarian siswa.</p>
        </td>
      </tr>`;
    renderAdminListPager(tb,'adminStudentPager',adminStudentMeta,()=>{});
    return;
  }

  tb.innerHTML = rows.map((s, idx) => {
    let statusBadge = '<span class="badge bg-gray">BELUM UJIAN</span>';
    let actBtn = '';

    if (s.reset_exam_id) {
      statusBadge = '<span class="badge bg-red"><i class="fa-solid fa-lock"></i> DIHENTIKAN</span>';
      actBtn = `<button class="btn btn-warning" style="padding:4px 8px; font-size:11px;" onclick="resetCbtAttempt(${Number(s.id)},${Number(s.reset_exam_id)})" title="Reset ${String(s.reset_exam_name || 'ujian CBT').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"><i class="fa-solid fa-unlock"></i> Reset CBT</button>`;
    } else if (s.ujian_status === 'dihentikan') {
      statusBadge = '<span class="badge bg-red"><i class="fa-solid fa-lock"></i> DIHENTIKAN — JADWAL BERAKHIR</span>';
    } else if (s.ujian_status === 'berlangsung') {
      statusBadge = '<span class="badge bg-blue"><i class="fa-solid fa-spinner fa-spin"></i> SEDANG UJIAN</span>';
    } else if (s.ujian_status === 'selesai') {
      statusBadge = '<span class="badge bg-green"><i class="fa-solid fa-circle-check"></i> SELESAI</span>';
    }

    const pinDisplay = s.pin === 'PERLU DIGANTI'
      ? `<span class="badge bg-red"><i class="fa-solid fa-triangle-exclamation"></i> Perlu Ganti PIN</span>`
      : s.pin && s.pin !== 'BELUM DISET'
      ? `<code style="background:var(--primary-soft); color:var(--primary-dark); font-weight:800; padding:3px 8px; border-radius:5px; font-size:12.5px; letter-spacing:1px; border:1px solid var(--primary-soft-border);">${s.pin}</code>`
      : `<span style="color:var(--danger); font-size:11px; font-weight:700;">Belum Diset</span>`;

    return `
      <tr>
        <td style="font-weight:700; color:var(--text-muted); text-align:center;">${(adminStudentMeta.page-1)*adminStudentMeta.limit+idx + 1}</td>
        <td>
          <div style="font-weight:800; color:var(--text-main); font-size:13px; font-family:monospace;">${s.nomor_ujian || s.nisn}</div>
        </td>
        <td>
          <div style="font-weight:700; color:var(--text-main); font-size:13px;">${s.nama}</div>
          <small style="color:var(--text-muted); font-size:11px;">Tahun Ajaran: ${s.tahun_ajaran || '2025/2026'}</small>
        </td>
        <td><strong style="color:var(--primary-dark);">${s.kelas}</strong></td>
        <td><span class="badge bg-gray">Tingkat ${s.tingkat}</span></td>
        <td>${pinDisplay}</td>
        <td>${statusBadge}</td>
        <td>
          <div style="display:flex; gap:6px; justify-content:center; align-items:center;">
            ${actBtn}
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick="generatePinAdmin(${s.id})" title="Generate / Ganti PIN">
              <i class="fa-solid fa-key"></i> PIN
            </button>
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick="editSiswaSatuanById(${s.id})" title="Edit PIN">
              <i class="fa-solid fa-pen"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  renderAdminListPager(tb,'adminStudentPager',adminStudentMeta,page=>{adminStudentPage=page;loadDataAdminSiswa(false);});
}

// SINGLE STUDENT PIN GENERATION
function generatePinAdmin(id) {
  showLoading('Membuat PIN baru...');
  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      loadDataAdminSiswa();
      showCustomAlert('PIN Berhasil Dibuat', `PIN ujian siswa berhasil digenerate: <b>${res.pin}</b>`, 'success');
    })
    .withFailureHandler(err => {
      hideLoading();
      showCustomAlert('Gagal Membuat PIN', `Terjadi kesalahan saat membuat PIN: ${err.message}`, 'error');
    })
    .simpanSiswaSatuanAdmin(stPengelola, { id, pin: '' });
}

// MODAL GENERATE PIN MASSAL OTOMATIS
function bukaModalGeneratePinOtomatis() {
  updateScopeInfoGeneratePin();
  document.getElementById('modalGeneratePinMassal').classList.add('show');
}

function updateScopeInfoGeneratePin() {
  const scope = document.getElementById('selScopeGeneratePin')?.value;
  const boxInfo = document.getElementById('boxTargetInfoGeneratePin');
  if (!boxInfo) return;

  const ting = document.getElementById('fltSiswaTingkat')?.value || 'ALL';
  const kelas = document.getElementById('fltSiswaKelas')?.value || 'ALL';

  if (scope === 'CURRENT_FILTER') {
    boxInfo.innerHTML = `Target: <b>Siswa yang difilter saat ini</b> (Tingkat: ${ting}, Kelas: ${kelas}).`;
  } else if (scope === 'ALL') {
    boxInfo.innerHTML = `Target: <b>Seluruh Siswa Aktif</b> (Tingkat X, XI, dan XII).`;
  } else if (scope === 'GRADE_X') {
    boxInfo.innerHTML = `Target: <b>Seluruh Siswa Tingkat X</b>.`;
  } else if (scope === 'GRADE_XI') {
    boxInfo.innerHTML = `Target: <b>Seluruh Siswa Tingkat XI</b>.`;
  } else if (scope === 'GRADE_XII') {
    boxInfo.innerHTML = `Target: <b>Seluruh Siswa Tingkat XII</b>.`;
  }
}

function eksekusiGeneratePinMassal(e) {
  e.preventDefault();
  const scope = document.getElementById('selScopeGeneratePin').value;
  let targetGrade = null;
  let targetClass = null;

  if (scope === 'CURRENT_FILTER') {
    targetGrade = document.getElementById('fltSiswaTingkat')?.value;
    targetClass = document.getElementById('fltSiswaKelas')?.value;
  } else if (scope === 'GRADE_X') {
    targetGrade = 'X';
  } else if (scope === 'GRADE_XI') {
    targetGrade = 'XI';
  } else if (scope === 'GRADE_XII') {
    targetGrade = 'XII';
  }

  jalankanGeneratePinMassal(targetGrade, targetClass);
}

function jalankanGeneratePinMassal(targetGrade, targetClass) {
  const submitButton = document.getElementById('btnGeneratePinMassal');
  if (submitButton?.disabled) return;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
  }

  let totalUpdated = 0;
  const generatedCredentials = [];
  let cursor = 0;
  let cancelRequested = false;
  const requestCancel = () => {
    cancelRequested = true;
    document.getElementById('loaderText').textContent = 'Menghentikan setelah batch saat ini selesai...';
  };
  showLoading('Menyiapkan generate PIN otomatis...', requestCancel);

  const finishCancelled = () => {
      hideLoading();
      document.getElementById('modalGeneratePinMassal').classList.remove('show');
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fa-solid fa-bolt"></i> Mulai Generate PIN';
      }
      downloadGeneratedPinExcel(generatedCredentials);
      loadDataAdminSiswa();
      showCustomAlert('Generate PIN Dibatalkan', `Proses dihentikan. ${totalUpdated} PIN yang sudah dibuat tetap diunduh dalam Excel.`, 'warning');
  };

  const finish = () => {
      hideLoading();
      document.getElementById('modalGeneratePinMassal').classList.remove('show');
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fa-solid fa-bolt"></i> Mulai Generate PIN';
      }
      downloadGeneratedPinExcel(generatedCredentials);
      loadDataAdminSiswa();
      showCustomAlert(
        'Generate PIN Berhasil',
        `Berhasil membuat PIN otomatis baru untuk ${totalUpdated} siswa. Excel kredensial telah diunduh satu kali; simpan dengan aman karena PIN tidak dapat ditampilkan kembali.`,
        'success'
      );
  };

  const fail = err => {
      hideLoading();
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fa-solid fa-bolt"></i> Mulai Generate PIN';
      }
      const hasCompletedBatch = generatedCredentials.length > 0;
      if (hasCompletedBatch) downloadGeneratedPinExcel(generatedCredentials);
      const savedProgress = hasCompletedBatch ? ' PIN dari batch yang sudah berhasil telah diunduh dalam Excel.' : '';
      const reason = err?.code === 'REQUEST_TIMEOUT' || err?.status === 408 ? `Server belum menyelesaikan batch tepat waktu. Silakan jalankan kembali.${savedProgress}` : `${err?.message || 'Permintaan gagal.'}${savedProgress}`;
      showCustomAlert(
        'Generate PIN Gagal',
        `Proses berhenti setelah ${totalUpdated} siswa. ${reason}`,
        'error'
      );
  };

  const processNextBatch = () => {
    cbtApi
      .withSuccessHandler(res => {
        totalUpdated += Number(res.updated) || 0;
        if (Array.isArray(res.credentials)) generatedCredentials.push(...res.credentials);
        cursor = Number(res.next_cursor) || cursor;
        const total = Number(res.total) || totalUpdated;
        if (cancelRequested) finishCancelled();
        else if (res.done) finish();
        else showLoading(`Membuat PIN otomatis: ${Math.min(totalUpdated, total)} dari ${total} siswa...`, requestCancel);
        if (!cancelRequested && !res.done) setTimeout(processNextBatch, 50);
      })
      .withFailureHandler(fail)
      .generatePinsBatchAdmin(stPengelola, {
        tingkat: targetGrade,
        kelas: targetClass,
        cursor,
        limit: 5
      });
  };

  processNextBatch();
}

function downloadGeneratedPinExcel(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  exportToExcel(
    `pin-cbt-${new Date().toISOString().slice(0, 10)}.xlsx`,
    'Kredensial PIN',
    ['NISN', 'Nama', 'Kelas', 'PIN'],
    rows.map(row => [String(row.nisn ?? ''), row.nama, row.kelas, String(row.pin ?? '')])
  );
}

function editSiswaSatuanById(id) {
  const s = (cacheSiswaGlobal || []).find(x => String(x.id) === String(id));
  if (s) bukaModalSiswaSatuan(s);
}

function bukaModalSiswaSatuan(data = null) {
  document.getElementById('formSiswaSatuan').reset();
  if (data) {
    document.getElementById('titleModalSiswa').textContent = "Edit PIN Siswa";
    document.getElementById('editSiswaId').value = data.id;
    document.getElementById('inSiswaNo').value = data.nomor_ujian || data.nisn;
    document.getElementById('inSiswaNama').value = data.nama;
    document.getElementById('inSiswaKelas').value = data.kelas;
    document.getElementById('inSiswaPin').value = (data.pin && !['BELUM DISET','PERLU DIGANTI'].includes(data.pin)) ? data.pin : '';
  }
  document.getElementById('modalSiswaSatuan').classList.add('show');
}

function editSiswaSatuan(s) {
  bukaModalSiswaSatuan(s);
}

document.getElementById('formSiswaSatuan').addEventListener('submit', function (e) {
  e.preventDefault();
  const payload = {
    id: document.getElementById('editSiswaId').value,
    pin: document.getElementById('inSiswaPin').value.trim()
  };
  showLoading('Menyimpan PIN siswa...');
  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      if (res.success) {
        document.getElementById('modalSiswaSatuan').classList.remove('show');
        loadDataAdminSiswa();
        showCustomAlert('PIN Berhasil Disimpan', `PIN siswa berhasil diperbarui: <b>${res.pin}</b>`, 'success');
      } else {
        showCustomAlert('Gagal Menyimpan', res.message, 'error');
      }
    })
    .withFailureHandler(err => {
      hideLoading();
      showCustomAlert('Error', err.message, 'error');
    })
    .simpanSiswaSatuanAdmin(stPengelola, payload);
});

function bukaBlokirAdmin(id) {
  switchDashTab('tabAdminLogPelanggaran');
  showCustomAlert('Reset CBT', 'Buka Log Pelanggaran, lalu klik Reset CBT pada ujian siswa yang dihentikan. Jawaban sebelumnya tetap tersimpan.');
}

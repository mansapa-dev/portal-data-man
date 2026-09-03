// Administrator student controls backed by Portal Data synchronization, Alphabet Pills, and Batch PIN generation.
let activeSiswaAbjadFilter = 'ALL';

function loadDataAdminSiswa() {
  const tb = document.getElementById('tblAdminSiswa');
  if (tb) tb.innerHTML = `<tr><td colspan="8" align="center" style="padding:24px;">Memuat data peserta ujian...</td></tr>`;

  loadPortalReferences(() => {
    populateAdminSiswaFilters();
    applyFilterSiswa();
  });

  cbtApi
    .withSuccessHandler(rows => {
      cacheSiswaGlobal = Array.isArray(rows) ? rows : (rows?.data || []);
      populateAdminSiswaFilters();
      applyFilterSiswa();
    })
    .withFailureHandler(err => {
      showCustomAlert('Gagal Memuat Data', `Terjadi kesalahan saat mengambil data siswa: ${err.message}`, 'error');
      if (tb) tb.innerHTML = `<tr><td colspan="8" align="center" style="padding:24px; color:var(--danger);">Gagal memuat data siswa: ${err.message}</td></tr>`;
    })
    .getAdminSiswaList(stPengelola);
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

function selectSiswaAbjadPill(letter) {
  activeSiswaAbjadFilter = letter;
  applyFilterSiswa();
}

function applyFilterSiswa() {
  const ting = document.getElementById('fltSiswaTingkat')?.value || 'ALL';
  const kelas = document.getElementById('fltSiswaKelas')?.value || 'ALL';
  const status = document.getElementById('fltSiswaStatus')?.value || 'ALL';
  const sort = document.getElementById('fltSiswaSort')?.value || 'nama_asc';
  const query = (document.getElementById('searchSiswa')?.value || '').toLowerCase().trim();

  const allClasses = portalReferences?.classes || [];

  // 1. Filter base list
  let filtered = (cacheSiswaGlobal || []).filter(s => {
    // Filter Tingkat
    if (ting !== 'ALL') {
      const sTingkat = String(s.tingkat || '').trim().toUpperCase();
      if (sTingkat !== ting.toUpperCase()) return false;
    }
    // Filter Kelas
    if (kelas !== 'ALL') {
      const studentClass = String(s.kelas || '').trim().toLowerCase();
      const targetClass = String(kelas || '').trim().toLowerCase();
      
      const matchedRef = allClasses.find(c => 
        String(c.name || '').toLowerCase() === targetClass || 
        String(c.code || '').toLowerCase() === targetClass || 
        String(c.portal_class_id || '').toLowerCase() === targetClass
      );
      const refName = String(matchedRef?.name || '').toLowerCase();
      const refCode = String(matchedRef?.code || '').toLowerCase();
      const refId = String(matchedRef?.portal_class_id || '').toLowerCase();

      const match = studentClass === targetClass ||
                    (refName && studentClass === refName) ||
                    (refCode && studentClass === refCode) ||
                    (refId && studentClass === refId) ||
                    studentClass.includes(targetClass);
      if (!match) return false;
    }
    // Filter Status Ujian
    if (status !== 'ALL') {
      const st = String(s.ujian_status || 'belum').toLowerCase();
      if (st !== status.toLowerCase()) return false;
    }
    // Filter Abjad Huruf Pertama Nama
    if (activeSiswaAbjadFilter && activeSiswaAbjadFilter !== 'ALL') {
      const firstChar = String(s.nama || '').trim().charAt(0).toUpperCase();
      if (firstChar !== activeSiswaAbjadFilter.toUpperCase()) return false;
    }
    // Search Query (NISN / Nama)
    if (query !== '') {
      const qText = `${s.nomor_ujian || ''} ${s.nisn || ''} ${s.nama || ''} ${s.kelas || ''} ${s.pin || ''}`.toLowerCase();
      if (!qText.includes(query)) return false;
    }
    return true;
  });

  // 2. Sort
  filtered.sort((a, b) => {
    if (sort === 'nama_asc') return String(a.nama || '').localeCompare(String(b.nama || ''));
    if (sort === 'nama_desc') return String(b.nama || '').localeCompare(String(a.nama || ''));
    if (sort === 'nisn_asc') return String(a.nomor_ujian || a.nisn || '').localeCompare(String(b.nomor_ujian || b.nisn || ''));
    if (sort === 'kelas_asc') return String(a.kelas || '').localeCompare(String(b.kelas || ''), undefined, { numeric: true });
    return 0;
  });

  // 3. Update Excel Cache
  window.cacheSiswaExcel = filtered.map(s => [
    s.nomor_ujian || s.nisn,
    s.nama,
    s.kelas,
    s.tingkat,
    s.pin,
    s.tahun_ajaran || '2025/2026',
    (s.ujian_status || 'belum').toUpperCase()
  ]);

  // 4. Update count label
  const lblCount = document.getElementById('lblTotalSiswaTerfilter');
  if (lblCount) lblCount.textContent = `${filtered.length} Siswa Ditemukan`;

  // 5. Render alphabet pills & table
  renderSiswaAbjadPills(cacheSiswaGlobal || []);
  renderTabelSiswa(filtered);
}

function renderSiswaAbjadPills(allRows) {
  const container = document.getElementById('siswaAbjadPillsContainer');
  if (!container) return;

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  
  // Count students starting with each letter
  const counts = { 'ALL': (allRows || []).length };
  (allRows || []).forEach(s => {
    const char = String(s.nama || '').trim().charAt(0).toUpperCase();
    if (char && char >= 'A' && char <= 'Z') {
      counts[char] = (counts[char] || 0) + 1;
    }
  });

  const pills = ['ALL', ...alphabet];

  container.innerHTML = pills.map(p => {
    const isActive = activeSiswaAbjadFilter === p;
    const count = counts[p] || 0;
    const isZero = p !== 'ALL' && count === 0;

    return `
      <button type="button" 
              onclick="selectSiswaAbjadPill('${p}')" 
              class="btn ${isActive ? 'btn-primary' : 'btn-secondary'}" 
              style="padding:3px 8px; font-size:11px; min-width:32px; border-radius:6px; opacity:${isZero ? '0.45' : '1'}; flex-shrink:0; text-align:center;">
        <b>${p === 'ALL' ? 'Semua' : p}</b>
        ${count > 0 && p !== 'ALL' ? `<span style="font-size:9.5px; opacity:0.85; margin-left:2px;">(${count})</span>` : ''}
      </button>
    `;
  }).join('');
}

function renderTabelSiswa(rows) {
  const tb = document.getElementById('tblAdminSiswa');
  if (!tb) return;

  if (!rows || rows.length === 0) {
    tb.innerHTML = `
      <tr>
        <td colspan="8" align="center" style="padding:32px; color:var(--text-muted);">
          <i class="fa-solid fa-users-slash" style="font-size:32px; color:var(--text-muted); margin-bottom:10px; display:block;"></i>
          <div style="font-weight:700; font-size:14px; color:var(--text-main);">Tidak Ada Data Siswa yang Sesuai</div>
          <p style="font-size:12px; margin-top:4px;">Silakan sesuaikan filter tingkat, kelas, atau huruf abjad yang dipilih.</p>
        </td>
      </tr>`;
    return;
  }

  tb.innerHTML = rows.map((s, idx) => {
    let statusBadge = '<span class="badge bg-gray">BELUM UJIAN</span>';
    let actBtn = '';

    if (s.ujian_status === 'dihentikan') {
      statusBadge = '<span class="badge bg-red"><i class="fa-solid fa-lock"></i> DIHENTIKAN</span>';
      actBtn = `<button class="btn btn-success" style="padding:4px 8px; font-size:11px;" onclick="bukaBlokirAdmin(${s.id})" title="Buka Blokir"><i class="fa-solid fa-unlock"></i> Buka</button>`;
    } else if (s.ujian_status === 'berlangsung') {
      statusBadge = '<span class="badge bg-blue"><i class="fa-solid fa-spinner fa-spin"></i> SEDANG UJIAN</span>';
    }

    const pinDisplay = s.pin && s.pin !== 'BELUM DISET' 
      ? `<code style="background:var(--primary-soft); color:var(--primary-dark); font-weight:800; padding:3px 8px; border-radius:5px; font-size:12.5px; letter-spacing:1px; border:1px solid var(--primary-soft-border);">${s.pin}</code>`
      : `<span style="color:var(--danger); font-size:11px; font-weight:700;">Belum Diset</span>`;

    return `
      <tr>
        <td style="font-weight:700; color:var(--text-muted); text-align:center;">${idx + 1}</td>
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

  const labels = { CURRENT_FILTER: 'siswa yang sedang difilter', ALL: 'seluruh siswa aktif', GRADE_X: 'seluruh siswa tingkat X', GRADE_XI: 'seluruh siswa tingkat XI', GRADE_XII: 'seluruh siswa tingkat XII' };
  showCustomConfirm(
    'Yakin Generate PIN Otomatis?',
    `Anda akan mengganti PIN lama untuk ${labels[scope] || 'target yang dipilih'} dengan PIN acak 4 digit. Tindakan ini tidak dapat dibatalkan. Lanjutkan generate PIN?`,
    () => jalankanGeneratePinMassal(targetGrade, targetClass)
  );
}

function jalankanGeneratePinMassal(targetGrade, targetClass) {
  document.getElementById('modalGeneratePinMassal').classList.remove('show');

  showLoading('Meng-generate PIN otomatis untuk seluruh target siswa...');

  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      loadDataAdminSiswa();
      showCustomAlert(
        'Generate PIN Berhasil',
        `Berhasil membuat PIN otomatis baru untuk <b>${res.updated} siswa</b>.`,
        'success'
      );
    })
    .withFailureHandler(err => {
      hideLoading();
      showCustomAlert(
        'Generate PIN Gagal',
        `Gagal memproses pembuatan PIN: ${err.message}`,
        'error'
      );
    })
    .generatePinsBatchAdmin(stPengelola, {
      tingkat: targetGrade,
      kelas: targetClass
    });
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
    document.getElementById('inSiswaPin').value = (data.pin && data.pin !== 'BELUM DISET') ? data.pin : '';
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
  showCustomConfirm("Buka Akses Siswa", "Buka blokir dan reset status ujian siswa ini agar dapat login kembali?", () => {
    showLoading('Membuka akses siswa...');
    cbtApi
      .withSuccessHandler(res => {
        hideLoading();
        if (res.success) {
          loadDataAdminSiswa();
          showCustomAlert('Akses Dibuka', 'Status ujian siswa berhasil direset dan dapat login kembali.', 'success');
        } else {
          showCustomAlert('Gagal', res.message, 'error');
        }
      })
      .withFailureHandler(err => {
        hideLoading();
        showCustomAlert('Error', err.message, 'error');
      })
      .adminBukaBlokirSiswa(stPengelola, id);
  });
}

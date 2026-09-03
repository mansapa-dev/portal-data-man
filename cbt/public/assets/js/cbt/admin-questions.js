// Administrator question bank management with Subject Panels & Image Uploads.
let cacheAdminSoalRows = [];
let activeSoalMapelFilter = 'ALL';
let attachedGambarSoalBase64 = '';

function loadDataAdminSoal() {
  loadPortalReferences(() => {
    populateAdminSoalFilters();
    applyFilterSoal();
  });

  const container = document.getElementById('containerPanelsSoal');
  if (container) {
    container.innerHTML = `
      <div style="text-align:center; padding:30px; color:var(--text-muted); font-size:13px;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:20px; color:var(--primary); margin-bottom:8px; display:block;"></i>
        Memuat bank soal per mata pelajaran...
      </div>`;
  }

  cbtApi
    .withSuccessHandler(rows => {
      cacheAdminSoalRows = rows || [];
      populateAdminSoalFilters();
      applyFilterSoal();
    })
    .getAdminSoalList(stPengelola, null);
}

function populateAdminSoalFilters() {
  const tingVal = document.getElementById('fltSoalTingkat')?.value || 'ALL';

  // Populate Mapel Filter
  const fltMapel = document.getElementById('fltSoalMapel');
  if (fltMapel && portalReferences && portalReferences.subjects) {
    const currentVal = fltMapel.value;
    const sortedSubjects = [...portalReferences.subjects].sort((a, b) => (a.name || a.code || '').localeCompare(b.name || b.code || ''));
    fltMapel.innerHTML = `<option value="ALL">Semua Mata Pelajaran</option>` + sortedSubjects.map(s => `
      <option value="${s.name}">${s.code} — ${s.name}</option>
    `).join('');
    if (currentVal && (currentVal === 'ALL' || sortedSubjects.some(s => s.name === currentVal))) {
      fltMapel.value = currentVal;
    }
  }

  // Populate Rombel / Kelas Filter
  const fltKelas = document.getElementById('fltSoalKelas');
  if (fltKelas && portalReferences && portalReferences.classes) {
    const currentVal = fltKelas.value;
    const availableClasses = portalReferences.classes.filter(c => tingVal === 'ALL' || c.grade === tingVal);
    const sortedClasses = [...availableClasses].sort((a, b) => (a.name || a.code || '').localeCompare(b.name || b.code || '', undefined, { numeric: true }));
    fltKelas.innerHTML = `<option value="ALL">Semua Kelas</option>` + sortedClasses.map(c => `
      <option value="${c.name || c.code}">${c.name || c.code}</option>
    `).join('');
    if (currentVal && sortedClasses.some(c => (c.name || c.code) === currentVal)) {
      fltKelas.value = currentVal;
    } else {
      fltKelas.value = 'ALL';
    }
  }
}

function selectSoalMapelPill(mapelName) {
  activeSoalMapelFilter = mapelName;
  const fltMapel = document.getElementById('fltSoalMapel');
  if (fltMapel) fltMapel.value = mapelName;
  applyFilterSoal();
}

function applyFilterSoal() {
  const ting = document.getElementById('fltSoalTingkat')?.value || 'ALL';
  const mapel = document.getElementById('fltSoalMapel')?.value || 'ALL';
  const kelas = document.getElementById('fltSoalKelas')?.value || 'ALL';
  const query = (document.getElementById('searchSoal')?.value || '').toLowerCase().trim();

  // Sync active filter
  activeSoalMapelFilter = mapel;

  const filtered = cacheAdminSoalRows.filter(s => {
    // Filter Tingkat
    if (ting !== 'ALL' && String(s.tingkat || '').toUpperCase() !== ting.toUpperCase()) {
      return false;
    }
    // Filter Mapel
    if (mapel !== 'ALL' && String(s.nama_mapel || '').trim().toLowerCase() !== mapel.trim().toLowerCase()) {
      return false;
    }
    // Filter Kelas
    if (kelas !== 'ALL') {
      const targetNames = String(s.target_kelas_names || '').toLowerCase();
      const targetIds = String(s.target_kelas_ids || '').toLowerCase();
      if (targetNames && !targetNames.includes('semua') && !targetNames.includes(kelas.toLowerCase()) && !targetIds.includes(kelas.toLowerCase())) {
        return false;
      }
    }
    // Query Search
    if (query !== '') {
      const qText = `${s.id} ${s.pertanyaan} ${s.opsi_a} ${s.opsi_b} ${s.opsi_c} ${s.opsi_d} ${s.opsi_e || ''} ${s.nama_mapel || ''} ${s.nama_ujian || ''}`.toLowerCase();
      if (!qText.includes(query)) return false;
    }
    return true;
  });

  // Prepare Excel cache
  window.cacheSoalExcel = filtered.map(s => [
    s.id,
    s.exam_id || s.ujian_id,
    s.nama_mapel || 'Mapel',
    s.tingkat || 'Umum',
    s.pertanyaan.replace(/<[^>]*>?/gm, ' '),
    s.opsi_a,
    s.opsi_b,
    s.opsi_c,
    s.opsi_d,
    s.opsi_e || '',
    s.jawaban_benar,
    s.poin || 1
  ]);

  renderSoalMapelPills(cacheAdminSoalRows);
  renderSoalPanelsBySubject(filtered);
}

function renderSoalMapelPills(allRows) {
  const container = document.getElementById('soalMapelPillsContainer');
  if (!container) return;

  // Group counts by mapel
  const counts = { 'ALL': allRows.length };
  allRows.forEach(s => {
    const m = s.nama_mapel || 'Mapel Umum';
    counts[m] = (counts[m] || 0) + 1;
  });

  const subjects = Object.keys(counts).filter(k => k !== 'ALL').sort();
  const pills = ['ALL', ...subjects];

  container.innerHTML = pills.map(p => {
    const isActive = activeSoalMapelFilter === p;
    const label = p === 'ALL' ? 'Semua Mapel' : p;
    const count = counts[p] || 0;
    return `
      <button type="button" onclick="selectSoalMapelPill('${p.replace(/'/g, "\\'")}')" class="btn ${isActive ? 'btn-primary' : 'btn-secondary'}" style="padding:5px 12px; font-size:12px; border-radius:20px; white-space:nowrap; display:inline-flex; align-items:center; gap:6px; flex-shrink:0;">
        <span>${label}</span>
        <span style="background:${isActive ? 'rgba(255,255,255,0.25)' : 'var(--primary-soft)'}; color:${isActive ? '#fff' : 'var(--primary-dark)'}; padding:2px 7px; border-radius:12px; font-size:11px; font-weight:700;">${count}</span>
      </button>
    `;
  }).join('');
}

function renderSoalPanelsBySubject(filteredRows) {
  const container = document.getElementById('containerPanelsSoal');
  if (!container) return;

  if (filteredRows.length === 0) {
    container.innerHTML = `
      <div style="background:var(--surface); border:1px dashed var(--border); border-radius:12px; padding:36px; text-align:center;">
        <i class="fa-solid fa-clipboard-question" style="font-size:36px; color:var(--text-muted); margin-bottom:12px; display:block;"></i>
        <h4 style="font-size:15px; font-weight:700; color:var(--text-main); margin-bottom:4px;">Tidak Ada Butir Soal Ditemukan</h4>
        <p style="font-size:12.5px; color:var(--text-muted); margin-bottom:16px;">Sesuaikan kriteria filter atau buat butir soal baru untuk mata pelajaran ini.</p>
        <button class="btn btn-primary" onclick="bukaModalSoal()"><i class="fa-solid fa-plus"></i> Tambah Soal Baru</button>
      </div>`;
    return;
  }

  // Group by nama_mapel
  const grouped = {};
  filteredRows.forEach(s => {
    const mapel = s.nama_mapel || 'Mata Pelajaran Umum';
    if (!grouped[mapel]) grouped[mapel] = [];
    grouped[mapel].push(s);
  });

  const mapelNames = Object.keys(grouped).sort();

  container.innerHTML = mapelNames.map((mapelName, idx) => {
    const list = grouped[mapelName];
    const firstExamId = list[0]?.exam_id || list[0]?.ujian_id;
    const tingkatSet = [...new Set(list.map(s => s.tingkat).filter(Boolean))].join(', ');
    const panelId = `panel_mapel_${idx}`;

    return `
      <div class="card" style="margin-bottom:0; border:1px solid var(--border); box-shadow:var(--shadow-xs); overflow:hidden;">
        <!-- PANEL HEADER -->
        <div style="background:var(--surface-subtle); border-bottom:1.5px solid var(--border); padding:12px 18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:34px; height:34px; border-radius:8px; background:var(--primary-soft); color:var(--primary-dark); display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:800;">
              <i class="fa-solid fa-book-bookmark"></i>
            </div>
            <div>
              <div style="font-size:14px; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                <span>${mapelName}</span>
                <span class="badge bg-green">${list.length} Soal</span>
                ${tingkatSet ? `<span class="badge bg-blue">Tingkat ${tingkatSet}</span>` : ''}
              </div>
              <small style="color:var(--text-muted); font-size:11px;">Kumpulan bank butir soal mata pelajaran ${mapelName}</small>
            </div>
          </div>

          <div style="display:flex; gap:8px; align-items:center;">
            <button type="button" class="btn btn-secondary" style="padding:4px 10px; font-size:11.5px;" onclick="bukaModalSoalDenganExam(${firstExamId})">
              <i class="fa-solid fa-plus"></i> Tambah Soal Mapel Ini
            </button>
            <button type="button" class="btn btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="togglePanelVisibility('${panelId}', this)" title="Sembunyikan / Tampilkan">
              <i class="fa-solid fa-chevron-up"></i>
            </button>
          </div>
        </div>

        <!-- PANEL CONTENT TABLE -->
        <div id="${panelId}" class="table-responsive" style="padding:0;">
          <table style="margin:0;">
            <thead>
              <tr>
                <th style="width:50px;">No</th>
                <th>Teks Pertanyaan & Lampiran Gambar</th>
                <th style="width:180px;">Pilihan Opsi Jawaban</th>
                <th style="width:90px;">Kunci</th>
                <th style="width:70px;">Poin</th>
                <th style="width:80px;">Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${list.map((s, num) => {
                return `
                  <tr>
                    <td style="font-weight:700; color:var(--text-muted); text-align:center;">${num + 1}</td>
                    <td style="max-width:380px;">
                      <div style="font-size:13px; color:var(--text-main); line-height:1.45;">
                        ${s.pertanyaan}
                      </div>
                      <small style="color:var(--text-muted); font-size:10.5px; margin-top:4px; display:block;">
                        <i class="fa-solid fa-calendar-check" style="font-size:10px;"></i> Ujian: <b>${s.nama_ujian || 'ID ' + (s.exam_id || s.ujian_id)}</b>
                      </small>
                    </td>
                    <td>
                      <div style="display:flex; flex-direction:column; gap:2px; font-size:11.5px;">
                        <div style="${s.jawaban_benar==='A'?'font-weight:700; color:var(--primary-dark);':''}"><span class="badge ${s.jawaban_benar==='A'?'bg-green':'bg-gray'}" style="padding:1px 5px; font-size:10px;">A</span> ${s.opsi_a}</div>
                        <div style="${s.jawaban_benar==='B'?'font-weight:700; color:var(--primary-dark);':''}"><span class="badge ${s.jawaban_benar==='B'?'bg-green':'bg-gray'}" style="padding:1px 5px; font-size:10px;">B</span> ${s.opsi_b}</div>
                        <div style="${s.jawaban_benar==='C'?'font-weight:700; color:var(--primary-dark);':''}"><span class="badge ${s.jawaban_benar==='C'?'bg-green':'bg-gray'}" style="padding:1px 5px; font-size:10px;">C</span> ${s.opsi_c}</div>
                        <div style="${s.jawaban_benar==='D'?'font-weight:700; color:var(--primary-dark);':''}"><span class="badge ${s.jawaban_benar==='D'?'bg-green':'bg-gray'}" style="padding:1px 5px; font-size:10px;">D</span> ${s.opsi_d}</div>
                        ${s.opsi_e ? `<div style="${s.jawaban_benar==='E'?'font-weight:700; color:var(--primary-dark);':''}"><span class="badge ${s.jawaban_benar==='E'?'bg-green':'bg-gray'}" style="padding:1px 5px; font-size:10px;">E</span> ${s.opsi_e}</div>` : ''}
                      </div>
                    </td>
                    <td><span class="badge bg-green" style="font-size:12px; font-weight:800;">${s.jawaban_benar}</span></td>
                    <td><strong style="color:var(--text-main);">${s.poin || 1}</strong></td>
                    <td>
                      <button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick='editSoal(${JSON.stringify(s)})'>
                        <i class="fa-solid fa-pen"></i> Edit
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');
}

function togglePanelVisibility(panelId, btn) {
  const el = document.getElementById(panelId);
  if (!el) return;
  const isHidden = el.style.display === 'none';
  el.style.display = isHidden ? '' : 'none';
  if (btn) {
    btn.innerHTML = isHidden ? '<i class="fa-solid fa-chevron-up"></i>' : '<i class="fa-solid fa-chevron-down"></i>';
  }
}

function bukaModalSoalDenganExam(examId) {
  bukaModalSoal(null, examId);
}

// IMAGE ATTACHMENT HANDLERS
function handleGambarSoalFile(input) {
  const file = input.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showCustomAlert('File Terlalu Besar', 'Maksimal ukuran file gambar adalah 2MB.');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    attachedGambarSoalBase64 = e.target.result;
    document.getElementById('inGambarSoalUrl').value = '';
    const previewContainer = document.getElementById('previewGambarContainer');
    const previewImg = document.getElementById('imgPreviewElement');
    if (previewImg && previewContainer) {
      previewImg.src = attachedGambarSoalBase64;
      previewContainer.classList.remove('hidden');
    }
  };
  reader.readAsDataURL(file);
}

function handleGambarSoalUrlInput(url) {
  const clean = String(url || '').trim();
  const previewContainer = document.getElementById('previewGambarContainer');
  const previewImg = document.getElementById('imgPreviewElement');
  if (clean !== '') {
    attachedGambarSoalBase64 = '';
    const fileIn = document.getElementById('inGambarSoalFile');
    if (fileIn) fileIn.value = '';
    if (previewImg && previewContainer) {
      previewImg.src = clean;
      previewContainer.classList.remove('hidden');
    }
  } else if (!attachedGambarSoalBase64) {
    if (previewContainer) previewContainer.classList.add('hidden');
  }
}

function hapusGambarSoalModal() {
  attachedGambarSoalBase64 = '';
  const fileIn = document.getElementById('inGambarSoalFile');
  if (fileIn) fileIn.value = '';
  const urlIn = document.getElementById('inGambarSoalUrl');
  if (urlIn) urlIn.value = '';
  const previewContainer = document.getElementById('previewGambarContainer');
  if (previewContainer) previewContainer.classList.add('hidden');
}

function bukaModalSoal(data = null, preselectedExamId = null) {
  document.getElementById('formSoal').reset();
  hapusGambarSoalModal();
  showLoading('Memuat daftar jadwal ujian...');

  cbtApi
    .withSuccessHandler(ujianList => {
      hideLoading();
      const sel = document.getElementById('inSoalUjianId');
      sel.innerHTML = ujianList.map(u => `
        <option value="${u.id}">${u.nama_ujian} (${u.nama_mapel || 'Mapel'} — Tingkat ${u.tingkat})</option>
      `).join('');

      if (preselectedExamId) {
        sel.value = preselectedExamId;
      }

      if (data) {
        document.getElementById('titleModalSoal').textContent = "Edit Soal Pilihan Ganda";
        document.getElementById('editSoalId').value = data.id;
        sel.value = data.exam_id || data.ujian_id;

        // Check if question contains image tag
        let rawPertanyaan = data.pertanyaan || '';
        const imgMatch = rawPertanyaan.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch && imgMatch[1]) {
          const imgSrc = imgMatch[1];
          handleGambarSoalUrlInput(imgSrc);
          document.getElementById('inGambarSoalUrl').value = imgSrc;
          // Clean image tag from textarea for clean text editing
          rawPertanyaan = rawPertanyaan.replace(/<br\s*\/?>\s*<img[^>]*>/gi, '').replace(/<img[^>]*>/gi, '').trim();
        }

        document.getElementById('inPertanyaan').value = rawPertanyaan;
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

function editSoal(s) {
  bukaModalSoal(s);
}

document.getElementById('formSoal').addEventListener('submit', function (e) {
  e.preventDefault();
  let pertanyaanText = document.getElementById('inPertanyaan').value.trim();
  const gambarUrl = document.getElementById('inGambarSoalUrl').value.trim();
  const activeImage = attachedGambarSoalBase64 || gambarUrl;

  if (activeImage && !pertanyaanText.includes('<img')) {
    pertanyaanText += `<br><img src="${activeImage}" style="max-width:100%; max-height:280px; object-fit:contain; border-radius:8px; margin:8px 0; display:block;" />`;
  }

  const payload = {
    id: document.getElementById('editSoalId').value || null,
    ujian_id: document.getElementById('inSoalUjianId').value,
    pertanyaan: pertanyaanText,
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
      if (res.success) {
        document.getElementById('modalSoal').classList.remove('show');
        loadDataAdminSoal();
      } else {
        showCustomAlert('Gagal', res.message);
      }
    })
    .withFailureHandler(err => {
      hideLoading();
      showCustomAlert('Error', err.message);
    })
    .simpanSoalAdmin(stPengelola, payload);
});

function handleImportSoal(input) {
  handleExcelUpload(input, function (rows) {
    if (rows.length === 0) {
      showCustomAlert('Peringatan', 'File Excel soal kosong atau tidak valid.');
      return;
    }
    showLoading('Mengimport soal...');
    cbtApi
      .withSuccessHandler(res => {
        hideLoading();
        showCustomAlert('Informasi', res.message);
        loadDataAdminSoal();
        input.value = '';
      })
      .withFailureHandler(err => {
        hideLoading();
        showCustomAlert('Import Gagal', err.message);
        input.value = '';
      })
      .importSoalBulk(stPengelola, rows);
  });
}

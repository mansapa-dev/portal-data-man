// Administrator question bank management (2-Level Subject Catalog & Detail View).
let cacheAdminSoalRows = [];
let currentSelectedMapelName = null;
let attachedGambarSoalBase64 = '';

// Icons mapping for Indonesian school subjects
const subjectIconMap = {
  'matematika': 'fa-calculator',
  'fisika': 'fa-atom',
  'kimia': 'fa-flask',
  'biologi': 'fa-dna',
  'bahasa indonesia': 'fa-book',
  'bahasa inggris': 'fa-earth-americas',
  'bahasa arab': 'fa-language',
  'sejarah': 'fa-landmark',
  'geografi': 'fa-mountain-sun',
  'sosiologi': 'fa-people-group',
  'ekonomi': 'fa-coins',
  'al-qur\'an': 'fa-quran',
  'qur\'an hadis': 'fa-quran',
  'akidah akhlak': 'fa-kaaba',
  'fiqih': 'fa-scale-balanced',
  'ski': 'fa-mosque',
  'penjas': 'fa-volleyball',
  'pjok': 'fa-person-running',
  'seni budaya': 'fa-palette',
  'pkn': 'fa-flag',
  'ppkn': 'fa-shield',
  'informatika': 'fa-laptop-code',
  'tik': 'fa-desktop'
};

function getSubjectIcon(name) {
  const clean = String(name || '').toLowerCase();
  for (const [key, icon] of Object.entries(subjectIconMap)) {
    if (clean.includes(key)) return icon;
  }
  return 'fa-book-open';
}

function loadDataAdminSoal() {
  loadPortalReferences(() => {
    if (currentSelectedMapelName) {
      applyFilterDetailSoal();
    } else {
      renderKatalogMapelGrid();
    }
  });

  const gridContainer = document.getElementById('gridKatalogMapelContainer');
  if (gridContainer && !currentSelectedMapelName) {
    gridContainer.innerHTML = `
      <div style="text-align:center; padding:30px; color:var(--text-muted); font-size:13px; grid-column:1/-1;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:20px; color:var(--primary); margin-bottom:8px; display:block;"></i>
        Memuat katalog mata pelajaran...
      </div>`;
  }

  cbtApi
    .withSuccessHandler(rows => {
      cacheAdminSoalRows = rows || [];
      if (currentSelectedMapelName) {
        populateDetailSoalFilters();
        applyFilterDetailSoal();
      } else {
        renderKatalogMapelGrid();
      }
    })
    .getAdminSoalList(stPengelola, null);
}

// ================= LEVEL 1: KATALOG MATA PELAJARAN =================
function renderKatalogMapelGrid() {
  const container = document.getElementById('gridKatalogMapelContainer');
  if (!container) return;

  const tingVal = document.getElementById('fltKatalogTingkat')?.value || 'ALL';
  const query = (document.getElementById('searchKatalogMapel')?.value || '').toLowerCase().trim();

  // Combine subjects from portalReferences & existing question subjects
  const subjectMap = {};

  if (portalReferences && portalReferences.subjects) {
    portalReferences.subjects.forEach(s => {
      const name = s.name;
      if (!subjectMap[name]) {
        subjectMap[name] = { id: s.id, code: s.code || '', name: s.name, questions: [] };
      }
    });
  }

  cacheAdminSoalRows.forEach(q => {
    const name = q.nama_mapel || 'Mata Pelajaran Umum';
    if (!subjectMap[name]) {
      subjectMap[name] = { id: q.subject_id || 0, code: q.kode_mapel || '', name: name, questions: [] };
    }
    subjectMap[name].questions.push(q);
  });

  let subjectList = Object.values(subjectMap);

  // Apply filters
  if (tingVal !== 'ALL') {
    subjectList = subjectList.filter(s => {
      if (s.questions.length === 0) return true;
      return s.questions.some(q => String(q.tingkat).toUpperCase() === tingVal.toUpperCase());
    });
  }

  if (query !== '') {
    subjectList = subjectList.filter(s => {
      return (s.name.toLowerCase().includes(query) || s.code.toLowerCase().includes(query));
    });
  }

  // Sort alphabetically
  subjectList.sort((a, b) => a.name.localeCompare(b.name));

  if (subjectList.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1; background:var(--surface); border:1px dashed var(--border); border-radius:12px; padding:36px; text-align:center;">
        <i class="fa-solid fa-book" style="font-size:36px; color:var(--text-muted); margin-bottom:12px; display:block;"></i>
        <h4 style="font-size:15px; font-weight:700; color:var(--text-main); margin-bottom:4px;">Mata Pelajaran Tidak Ditemukan</h4>
        <p style="font-size:12.5px; color:var(--text-muted); margin-bottom:16px;">Sesuaikan kata kunci pencarian atau buat butir soal baru.</p>
        <button class="btn btn-primary" onclick="bukaModalSoal()"><i class="fa-solid fa-plus"></i> Tambah Soal Baru</button>
      </div>`;
    return;
  }

  container.innerHTML = subjectList.map(s => {
    const totalSoal = s.questions.length;
    const grades = [...new Set(s.questions.map(q => q.tingkat).filter(Boolean))].sort().join(', ');
    const iconClass = getSubjectIcon(s.name);

    return `
      <div class="card subject-katalog-card" style="margin-bottom:0; padding:18px; border:1px solid var(--border); border-radius:12px; transition:all 0.2s ease; cursor:pointer; display:flex; flex-direction:column; justify-content:space-between; position:relative; overflow:hidden;" onclick="pilihDanBukaMapel('${s.name.replace(/'/g, "\\'")}')">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
            <div style="width:44px; height:44px; border-radius:10px; background:var(--primary-soft); color:var(--primary-dark); display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:800; border:1px solid var(--primary-soft-border);">
              <i class="fa-solid ${iconClass}"></i>
            </div>
            <span class="badge ${totalSoal > 0 ? 'bg-green' : 'bg-gray'}" style="font-size:11px; padding:3px 8px;">
              ${totalSoal} Soal
            </span>
          </div>

          <h4 style="font-size:15px; font-weight:800; color:var(--text-main); margin-bottom:4px; line-height:1.25;">
            ${s.name}
          </h4>
          <div style="font-size:11.5px; font-weight:600; color:var(--text-muted); margin-bottom:14px;">
            Kode: ${s.code || '-'}
          </div>
        </div>

        <div style="border-top:1px solid var(--border); padding-top:12px; margin-top:10px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:11px; color:var(--text-muted);">
            ${grades ? `Tingkat: <b>${grades}</b>` : 'Semua Tingkat'}
          </span>
          <span style="font-size:12px; font-weight:700; color:var(--primary-dark); display:inline-flex; align-items:center; gap:4px;">
            Buka Bank Soal <i class="fa-solid fa-chevron-right" style="font-size:10px;"></i>
          </span>
        </div>
      </div>
    `;
  }).join('');
}

function applyFilterKatalogMapel() {
  renderKatalogMapelGrid();
}

// ================= LEVEL 2: DETAIL BANK SOAL PER MAPEL =================
function pilihDanBukaMapel(mapelName) {
  currentSelectedMapelName = mapelName;

  document.getElementById('viewKatalogMapel').classList.add('hidden');
  document.getElementById('viewDetailMapelSoal').classList.remove('hidden');

  // Update banner title
  const elTitle = document.getElementById('lblDetailMapelTitle');
  if (elTitle) elTitle.textContent = mapelName;

  populateDetailSoalFilters();
  applyFilterDetailSoal();
}

function kembaliKeKatalogMapel() {
  currentSelectedMapelName = null;
  document.getElementById('viewDetailMapelSoal').classList.add('hidden');
  document.getElementById('viewKatalogMapel').classList.remove('hidden');
  renderKatalogMapelGrid();
}

function populateDetailSoalFilters() {
  if (!currentSelectedMapelName) return;

  const questionsForMapel = cacheAdminSoalRows.filter(q => (q.nama_mapel || '').trim().toLowerCase() === currentSelectedMapelName.trim().toLowerCase());

  // Populate Jadwal Ujian Filter
  const fltUjian = document.getElementById('fltDetailSoalUjian');
  if (fltUjian) {
    const examsMap = {};
    questionsForMapel.forEach(q => {
      const eid = q.exam_id || q.ujian_id;
      if (eid && !examsMap[eid]) {
        examsMap[eid] = q.nama_ujian || `Ujian #${eid}`;
      }
    });

    fltUjian.innerHTML = `<option value="ALL">Semua Jadwal Ujian (${Object.keys(examsMap).length})</option>` + Object.entries(examsMap).map(([id, name]) => `
      <option value="${id}">${name}</option>
    `).join('');
  }

  // Populate Kelas Filter
  const fltKelas = document.getElementById('fltDetailSoalKelas');
  const tingVal = document.getElementById('fltDetailSoalTingkat')?.value || 'ALL';
  if (fltKelas && portalReferences && portalReferences.classes) {
    const availableClasses = portalReferences.classes.filter(c => tingVal === 'ALL' || c.grade === tingVal);
    const sortedClasses = [...availableClasses].sort((a, b) => (a.name || a.code || '').localeCompare(b.name || b.code || '', undefined, { numeric: true }));
    fltKelas.innerHTML = `<option value="ALL">Semua Kelas</option>` + sortedClasses.map(c => `
      <option value="${c.name || c.code}">${c.name || c.code}</option>
    `).join('');
  }
}

function applyFilterDetailSoal() {
  if (!currentSelectedMapelName) return;

  const ting = document.getElementById('fltDetailSoalTingkat')?.value || 'ALL';
  const ujianId = document.getElementById('fltDetailSoalUjian')?.value || 'ALL';
  const kelas = document.getElementById('fltDetailSoalKelas')?.value || 'ALL';
  const query = (document.getElementById('searchDetailSoal')?.value || '').toLowerCase().trim();

  // Filter questions for the selected mapel
  const mapelQuestions = cacheAdminSoalRows.filter(s => (s.nama_mapel || '').trim().toLowerCase() === currentSelectedMapelName.trim().toLowerCase());

  const filtered = mapelQuestions.filter(s => {
    // Filter Tingkat
    if (ting !== 'ALL' && String(s.tingkat || '').toUpperCase() !== ting.toUpperCase()) {
      return false;
    }
    // Filter Ujian
    if (ujianId !== 'ALL' && String(s.exam_id || s.ujian_id) !== String(ujianId)) {
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
      const qText = `${s.id} ${s.pertanyaan} ${s.opsi_a} ${s.opsi_b} ${s.opsi_c} ${s.opsi_d} ${s.opsi_e || ''} ${s.nama_ujian || ''}`.toLowerCase();
      if (!qText.includes(query)) return false;
    }
    return true;
  });

  // Update banner badges
  const countBadge = document.getElementById('lblDetailMapelCountBadge');
  if (countBadge) countBadge.textContent = `${filtered.length} Soal Ditampilkan`;

  const gradesSet = [...new Set(filtered.map(s => s.tingkat).filter(Boolean))].sort().join(', ');
  const tingkatBadge = document.getElementById('lblDetailMapelTingkatBadge');
  if (tingkatBadge) tingkatBadge.textContent = gradesSet ? `Tingkat ${gradesSet}` : 'Semua Tingkat';

  // Prepare Excel cache
  window.cacheSoalExcel = filtered.map(s => [
    s.id,
    s.exam_id || s.ujian_id,
    currentSelectedMapelName,
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

  const tb = document.getElementById('tblDetailSoalMapel');
  if (!tb) return;

  if (filtered.length === 0) {
    tb.innerHTML = `
      <tr>
        <td colspan="6" align="center" style="padding:36px; color:var(--text-muted);">
          <i class="fa-solid fa-clipboard-question" style="font-size:32px; color:var(--text-muted); margin-bottom:10px; display:block;"></i>
          <div style="font-weight:700; font-size:14px; color:var(--text-main);">Belum Ada Butir Soal untuk Filter Ini</div>
          <p style="font-size:12px; margin-top:4px; margin-bottom:14px;">Tambahkan butir soal atau lakukan upload Excel untuk mata pelajaran ini.</p>
          <button class="btn btn-primary" style="padding:6px 14px; font-size:12px;" onclick="bukaModalSoalUntukMapelAktif()"><i class="fa-solid fa-plus"></i> Tambah Soal ${currentSelectedMapelName}</button>
        </td>
      </tr>`;
    return;
  }

  tb.innerHTML = filtered.map((s, num) => {
    return `
      <tr>
        <td style="font-weight:700; color:var(--text-muted); text-align:center;">${num + 1}</td>
        <td style="max-width:380px;">
          <div style="font-size:13px; color:var(--text-main); line-height:1.5;">
            ${s.pertanyaan}
          </div>
          <small style="color:var(--text-muted); font-size:11px; margin-top:6px; display:block;">
            <i class="fa-solid fa-calendar-check" style="font-size:10px; color:var(--primary);"></i> Ujian: <b>${s.nama_ujian || 'ID #' + (s.exam_id || s.ujian_id)}</b> 
            ${s.tingkat ? `<span class="badge bg-blue" style="margin-left:6px;">Tingkat ${s.tingkat}</span>` : ''}
          </small>
        </td>
        <td>
          <div style="display:flex; flex-direction:column; gap:3px; font-size:11.5px;">
            <div style="${s.jawaban_benar==='A'?'font-weight:700; color:var(--primary-dark);':''}"><span class="badge ${s.jawaban_benar==='A'?'bg-green':'bg-gray'}" style="padding:1px 5px; font-size:10px;">A</span> ${s.opsi_a}</div>
            <div style="${s.jawaban_benar==='B'?'font-weight:700; color:var(--primary-dark);':''}"><span class="badge ${s.jawaban_benar==='B'?'bg-green':'bg-gray'}" style="padding:1px 5px; font-size:10px;">B</span> ${s.opsi_b}</div>
            <div style="${s.jawaban_benar==='C'?'font-weight:700; color:var(--primary-dark);':''}"><span class="badge ${s.jawaban_benar==='C'?'bg-green':'bg-gray'}" style="padding:1px 5px; font-size:10px;">C</span> ${s.opsi_c}</div>
            <div style="${s.jawaban_benar==='D'?'font-weight:700; color:var(--primary-dark);':''}"><span class="badge ${s.jawaban_benar==='D'?'bg-green':'bg-gray'}" style="padding:1px 5px; font-size:10px;">D</span> ${s.opsi_d}</div>
            ${s.opsi_e ? `<div style="${s.jawaban_benar==='E'?'font-weight:700; color:var(--primary-dark);':''}"><span class="badge ${s.jawaban_benar==='E'?'bg-green':'bg-gray'}" style="padding:1px 5px; font-size:10px;">E</span> ${s.opsi_e}</div>` : ''}
          </div>
        </td>
        <td style="text-align:center;"><span class="badge bg-green" style="font-size:12px; font-weight:800; padding:4px 8px;">${s.jawaban_benar}</span></td>
        <td style="text-align:center;"><strong style="color:var(--text-main); font-size:13px;">${s.poin || 1}</strong></td>
        <td style="text-align:center;">
          <button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick='editSoal(${JSON.stringify(s)})'>
            <i class="fa-solid fa-pen"></i> Edit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function bukaModalSoalUntukMapelAktif() {
  let preselectedExamId = null;
  if (currentSelectedMapelName) {
    const found = cacheAdminSoalRows.find(s => (s.nama_mapel || '').trim().toLowerCase() === currentSelectedMapelName.trim().toLowerCase());
    preselectedExamId = found ? (found.exam_id || found.ujian_id) : null;
  }
  bukaModalSoal(null, preselectedExamId);
}

function exportExcelMapelAktif() {
  const filename = currentSelectedMapelName ? `bank_soal_${currentSelectedMapelName.toLowerCase().replace(/\s+/g, '_')}.xlsx` : 'bank_soal.xlsx';
  exportToExcel(filename, 'Soal', ['ID', 'Ujian ID', 'Nama Mapel', 'Tingkat', 'Pertanyaan', 'Opsi A', 'Opsi B', 'Opsi C', 'Opsi D', 'Opsi E', 'Jawaban Benar', 'Poin'], window.cacheSoalExcel || []);
}

// ================= QUESTION MODAL & IMAGE ATTACHMENT =================
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
      } else if (currentSelectedMapelName) {
        const found = ujianList.find(u => (u.nama_mapel || '').toLowerCase() === currentSelectedMapelName.toLowerCase());
        if (found) sel.value = found.id;
      }

      if (data) {
        document.getElementById('titleModalSoal').textContent = "Edit Soal Pilihan Ganda";
        document.getElementById('editSoalId').value = data.id;
        sel.value = data.exam_id || data.ujian_id;

        // Extract image tag if present
        let rawPertanyaan = data.pertanyaan || '';
        const imgMatch = rawPertanyaan.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch && imgMatch[1]) {
          const imgSrc = imgMatch[1];
          handleGambarSoalUrlInput(imgSrc);
          document.getElementById('inGambarSoalUrl').value = imgSrc;
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

// Administrator question bank management (2-Level Subject Catalog & Detail View).
let cacheAdminSoalRows = [];
let currentSelectedMapelName = null;
let attachedGambarSoalBase64 = '';
let pendingQuestionImport = null;

function escapeQuestionUiText(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

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
    .withFailureHandler(error => {
      cacheAdminSoalRows = [];
      if (gridContainer) {
        gridContainer.innerHTML = `
          <div style="grid-column:1/-1; background:var(--surface); border:1px solid var(--danger); border-radius:12px; padding:24px; color:var(--text-main); text-align:center;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size:28px; color:var(--danger); margin-bottom:10px; display:block;"></i>
            <h4 style="margin-bottom:5px;">Data soal gagal dimuat</h4>
            <p style="color:var(--text-muted); margin-bottom:14px;">${escapeQuestionUiText(error?.message || 'Terjadi kesalahan saat mengambil bank soal.')}</p>
            <button type="button" class="ui-button btn btn-secondary" onclick="loadDataAdminSoal()">Coba Lagi</button>
          </div>`;
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

function downloadTemplateSoalMapelAktif() {
  if (!currentSelectedMapelName) return showCustomAlert('Mata Pelajaran Belum Dipilih', 'Pilih mata pelajaran terlebih dahulu.', 'warning');
  showLoading('Menyiapkan template soal...');
  cbtApi
    .withSuccessHandler(ujianList => {
      hideLoading();
      const selectedName = currentSelectedMapelName.trim().toLowerCase();
      const exams = (ujianList || []).filter(ujian => String(ujian.nama_mapel || '').trim().toLowerCase() === selectedName);
      if (!exams.length) return showCustomAlert('Jadwal Ujian Belum Ada', `Buat jadwal ujian untuk ${currentSelectedMapelName} sebelum mengunduh template.`, 'warning');
      const questions = cacheAdminSoalRows.filter(question => String(question.nama_mapel || '').trim().toLowerCase() === selectedName);
      downloadTemplateSoal(currentSelectedMapelName, exams, questions);
    })
    .withFailureHandler(error => {
      hideLoading();
      showCustomAlert('Template Gagal Dibuat', error?.message || 'Daftar jadwal ujian tidak dapat dimuat.', 'error');
    })
    .getAdminUjianList(stPengelola);
}

function populateDetailSoalFilters() {
  if (!currentSelectedMapelName) return;

  const tingVal = document.getElementById('fltDetailSoalTingkat')?.value || 'ALL';
  const questionsForMapel = cacheAdminSoalRows.filter(q => (q.nama_mapel || '').trim().toLowerCase() === currentSelectedMapelName.trim().toLowerCase());

  // 1. Populate Dropdown Jadwal Ujian
  const fltUjian = document.getElementById('fltDetailSoalUjian');
  if (fltUjian) {
    const currentVal = fltUjian.value;
    const examsMap = {};
    questionsForMapel.forEach(q => {
      if (tingVal === 'ALL' || String(q.tingkat || '').toUpperCase() === tingVal.toUpperCase()) {
        const eid = q.exam_id || q.ujian_id;
        if (eid && !examsMap[eid]) {
          examsMap[eid] = q.nama_ujian || `Ujian #${eid}`;
        }
      }
    });

    const examEntries = Object.entries(examsMap);
    fltUjian.innerHTML = `<option value="ALL">Semua Jadwal Ujian (${examEntries.length})</option>` + examEntries.map(([id, name]) => `
      <option value="${id}">${name}</option>
    `).join('');

    if (currentVal && examsMap[currentVal]) {
      fltUjian.value = currentVal;
    } else {
      fltUjian.value = 'ALL';
    }
  }

  // 2. Populate Dropdown Kelas
  const fltKelas = document.getElementById('fltDetailSoalKelas');
  if (fltKelas) {
    const currentVal = fltKelas.value;
    const classSet = new Set();

    if (portalReferences && portalReferences.classes) {
      portalReferences.classes.forEach(c => {
        if (tingVal === 'ALL' || c.grade === tingVal) {
          const name = c.name || c.code;
          if (name) classSet.add(name);
        }
      });
    }

    questionsForMapel.forEach(q => {
      const tNames = String(q.target_kelas_names || '').split(',').map(s => s.trim()).filter(Boolean);
      tNames.forEach(n => {
        if (n && n.toLowerCase() !== 'semua' && (tingVal === 'ALL' || String(q.tingkat || '').toUpperCase() === tingVal.toUpperCase())) {
          classSet.add(n);
        }
      });
    });

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
          <div style="display:flex; justify-content:center; flex-wrap:wrap; gap:5px;">
            <button class="btn btn-secondary" style="padding:4px 7px; font-size:10.5px;" onclick="lihatSoalById(${s.id})" title="Lihat soal">
              <i class="fa-solid fa-eye"></i> Lihat
            </button>
            <button class="btn btn-secondary" style="padding:4px 7px; font-size:10.5px;" onclick="editSoalById(${s.id})" title="Ubah soal">
              <i class="fa-solid fa-pen"></i> Ubah
            </button>
            <button class="btn btn-danger" style="padding:4px 7px; font-size:10.5px;" onclick="hapusSoalById(${s.id})" title="Hapus soal">
              <i class="fa-solid fa-trash"></i> Hapus
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  typesetQuestionMath(tb);
}

function lihatSoalById(id) {
  const s = (cacheAdminSoalRows || []).find(x => String(x.id) === String(id));
  if (!s) return showCustomAlert('Soal Tidak Ditemukan', 'Muat ulang bank soal lalu coba kembali.', 'warning');
  document.getElementById('detailSoalMeta').textContent = `${s.nama_ujian || 'Ujian #' + (s.exam_id || s.ujian_id)} • ${s.nama_mapel || 'Mapel Umum'}${s.tingkat ? ' • Tingkat ' + s.tingkat : ''}`;
  document.getElementById('detailSoalPertanyaan').innerHTML = s.pertanyaan || '';
  const options = [['A', s.opsi_a], ['B', s.opsi_b], ['C', s.opsi_c], ['D', s.opsi_d], ['E', s.opsi_e]].filter(([, value]) => value);
  document.getElementById('detailSoalPilihan').innerHTML = options.map(([key, value]) => `
    <div style="display:flex; gap:8px; align-items:flex-start; padding:9px 10px; border:1px solid var(--border); border-radius:8px; ${key === s.jawaban_benar ? 'background:#ecfdf5; border-color:#86efac;' : 'background:var(--surface);'}">
      <span class="badge ${key === s.jawaban_benar ? 'bg-green' : 'bg-gray'}" style="min-width:24px; text-align:center;">${key}</span>
      <div style="font-size:13px; line-height:1.5;">${value}</div>
    </div>`).join('');
  document.getElementById('detailSoalKunci').textContent = s.jawaban_benar || '-';
  document.getElementById('detailSoalPoin').textContent = String(s.poin || 1);
  document.getElementById('btnUbahDariDetailSoal').onclick = () => {
    document.getElementById('modalDetailSoal').classList.remove('show');
    editSoalById(id);
  };
  document.getElementById('modalDetailSoal').classList.add('show');
  typesetQuestionMath([document.getElementById('detailSoalPertanyaan'), document.getElementById('detailSoalPilihan')]);
}

function editSoalById(id) {
  const s = (cacheAdminSoalRows || []).find(x => String(x.id) === String(id));
  if (s) bukaModalSoal(s);
}

function hapusSoalById(id) {
  const s = (cacheAdminSoalRows || []).find(x => String(x.id) === String(id));
  if (!s) return showCustomAlert('Soal Tidak Ditemukan', 'Muat ulang bank soal lalu coba kembali.', 'warning');
  showCustomConfirm('Hapus Soal', `Hapus soal #${id} dari bank soal? Riwayat ujian siswa tetap disimpan.`, () => {
    showLoading('Menghapus soal...');
    cbtApi
      .withSuccessHandler(res => {
        hideLoading();
        document.getElementById('modalDetailSoal')?.classList.remove('show');
        showCustomAlert('Soal Berhasil Dihapus', res.message || 'Soal telah dihapus dari bank soal.', 'success');
        loadDataAdminSoal();
      })
      .withFailureHandler(err => {
        hideLoading();
        showCustomAlert('Gagal Menghapus Soal', err.message, 'error');
      })
      .hapusSoalAdmin(stPengelola, id);
  });
}

function editSoal(s) {
  bukaModalSoal(s);
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

  if (file.size > 20 * 1024 * 1024) {
    showCustomAlert('File Terlalu Besar', 'Maksimal ukuran sumber gambar adalah 20 MB.');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async function (e) {
    try { attachedGambarSoalBase64 = await optimizeQuestionImageDataUrl(questionImageSourceDataUrl(file,e.target.result)); }
    catch (error) { input.value = ''; return showCustomAlert('Gambar Gagal Diproses', error.message, 'error'); }
    document.getElementById('inGambarSoalUrl').value = '';
    const previewContainer = document.getElementById('previewGambarContainer');
    const previewImg = document.getElementById('imgPreviewElement');
    if (previewImg && previewContainer) {
      previewImg.src = attachedGambarSoalBase64;
      previewContainer.classList.remove('hidden');
    }
  };
  reader.onerror = () => { input.value = ''; showCustomAlert('Gambar Gagal Dibaca', 'File gambar tidak dapat dibaca.', 'error'); };
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
  clearQuestionEditors();
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

        // Keep every inline image in its original position when an existing
        // question is edited; extracting only the first image lost the rest.
        setQuestionEditorValue('inPertanyaan', data.pertanyaan || '');
        setQuestionEditorValue('inOpsiA', data.opsi_a);
        setQuestionEditorValue('inOpsiB', data.opsi_b);
        setQuestionEditorValue('inOpsiC', data.opsi_c);
        setQuestionEditorValue('inOpsiD', data.opsi_d);
        setQuestionEditorValue('inOpsiE', data.opsi_e || '');
        document.getElementById('inJawabanBenar').value = data.jawaban_benar;
        document.getElementById('inPoinSoal').value = data.poin || 1;
      } else {
        document.getElementById('titleModalSoal').textContent = "Tambah Soal Baru";
        document.getElementById('editSoalId').value = "";
      }
      document.getElementById('modalSoal').classList.add('show');
      renderQuestionFormPreview();
    })
    .getAdminUjianList(stPengelola);
}

function editSoal(s) {
  bukaModalSoal(s);
}

let questionPreviewTimer=null;
function renderQuestionFormPreview(){const root=document.getElementById('questionFormPreview');if(!root)return;const question=safeQuestionPreviewHtml(questionEditorValue('inPertanyaan')),options=['A','B','C','D','E'].map(letter=>[letter,safeQuestionPreviewHtml(questionEditorValue(`inOpsi${letter}`))]).filter(([,value])=>value);root.innerHTML=`<div class="question-rich-content">${question||'<span class="text-muted">Preview pertanyaan</span>'}</div><div class="question-import-options">${options.map(([letter,value])=>`<div><b>${letter}.</b> <span>${value}</span></div>`).join('')}</div>`;typesetQuestionMath(root);}
['inPertanyaan','inOpsiA','inOpsiB','inOpsiC','inOpsiD','inOpsiE'].forEach(id=>document.getElementById(id)?.addEventListener('input',()=>{clearTimeout(questionPreviewTimer);questionPreviewTimer=setTimeout(renderQuestionFormPreview,180);}));
document.getElementById('formSoal').addEventListener('submit', function (e) {
  e.preventDefault();
  let pertanyaanText = questionEditorValue('inPertanyaan');
  const gambarUrl = document.getElementById('inGambarSoalUrl').value.trim();
  const activeImage = attachedGambarSoalBase64 || gambarUrl;

  const requiredEditors=['inPertanyaan','inOpsiA','inOpsiB','inOpsiC','inOpsiD'];
  if(requiredEditors.some(id=>!(id==='inPertanyaan'&&activeImage)&&!document.getElementById(id)?.textContent.trim()&&!document.getElementById(id)?.querySelector('img,math'))){
    return showCustomAlert('Data Belum Lengkap','Pertanyaan dan pilihan A sampai D wajib diisi.','warning');
  }

  if (activeImage && !pertanyaanText.includes('<img')) {
    pertanyaanText += `<br><img src="${activeImage}" style="max-width:100%; max-height:280px; object-fit:contain; border-radius:8px; margin:8px 0; display:block;" />`;
  }

  const payload = {
    id: document.getElementById('editSoalId').value || null,
    ujian_id: document.getElementById('inSoalUjianId').value,
    pertanyaan: pertanyaanText,
    opsi_a: questionEditorValue('inOpsiA'),
    opsi_b: questionEditorValue('inOpsiB'),
    opsi_c: questionEditorValue('inOpsiC'),
    opsi_d: questionEditorValue('inOpsiD'),
    opsi_e: questionEditorValue('inOpsiE'),
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
      showCustomAlert(err.status === 409 ? 'Peringatan Soal Duplikat' : 'Gagal Menyimpan Soal', err.message, err.status === 409 ? 'warning' : 'error');
    })
    .simpanSoalAdmin(stPengelola, payload);
});

function handleImportSoal(input){handleExcelUpload(input,rows=>{if(!rows.length)return showCustomAlert('Peringatan','File Excel soal kosong atau tidak valid.');showQuestionImportPreview(rows,input);});}

function validateQuestionImportRow(row,index){const errors=[...(row.__image_errors||[])],warnings=[...(row.__image_warnings||[])];if(String(row.no??'').trim()==='')errors.push('Nomor soal kosong');['pertanyaan','opsi_a','opsi_b','opsi_c','opsi_d'].forEach(key=>{if(!String(row[key]||'').trim())errors.push(`${key} kosong`);});const answer=String(row.jawaban_benar||'').trim().toUpperCase();if(!['A','B','C','D','E'].includes(answer))errors.push('Kunci jawaban harus A/B/C/D/E');else if(!String(row[`opsi_${answer.toLowerCase()}`]||'').trim())errors.push(`Pilihan ${answer} kosong tetapi dipilih sebagai kunci`);if(!(Number(row.poin??1)>0))errors.push('Bobot harus lebih dari 0');return{row:Number(row.__excel_row)||index+2,errors,warnings,status:errors.length?'ERROR':warnings.length?'WARNING':'VALID'};}

function showQuestionImportPreview(rows, input) {
  const validation = rows.map(validateQuestionImportRow);
  pendingQuestionImport = { rows, input, validation };
  let modal = document.getElementById('modalPreviewImportSoal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'modalPreviewImportSoal'; modal.className = 'modal';
    modal.innerHTML = '<div class="modal-content" style="width:min(900px,96vw);max-height:92vh;overflow:auto"><div class="modal-header"><h3>Preview Import Soal</h3><button type="button" class="btn-close" aria-label="Tutup">&times;</button></div><div id="questionImportSummary" class="alert"></div><div id="questionImportPreviewList" class="question-import-preview"></div><div class="modal-footer"><button type="button" class="ui-button btn btn-secondary" id="btnCancelQuestionImport">Batal</button><button type="button" class="ui-button btn btn-primary" id="btnConfirmQuestionImport">Import Final</button></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('.btn-close').onclick = modal.querySelector('#btnCancelQuestionImport').onclick = () => { modal.classList.remove('show'); pendingQuestionImport = null; if (input) input.value = ''; };
    modal.querySelector('#btnConfirmQuestionImport').onclick = confirmQuestionImport;
  }
  const errors = validation.filter(item => item.status === 'ERROR').length;
  const warnings = validation.filter(item => item.status === 'WARNING').length;
  const summary = modal.querySelector('#questionImportSummary'); summary.className = `alert ${errors ? 'error' : warnings ? 'warning' : 'success'}`; summary.textContent = `${rows.length} soal diperiksa: ${rows.length-errors-warnings} valid, ${warnings} warning, ${errors} error.`;
  modal.querySelector('#btnConfirmQuestionImport').disabled = errors > 0;
  modal.querySelector('#questionImportPreviewList').innerHTML = rows.map((row,index) => {
    const result=validation[index], options=['a','b','c','d','e'].filter(key=>String(row[`opsi_${key}`]||'').trim());
    const notes=[...result.errors,...result.warnings].map(note=>`<li>${escapeQuestionUiText(note)}</li>`).join('');
    return `<article class="question-import-card"><header><b>Soal ${escapeQuestionUiText(row.no || index+1)}</b><span class="badge ${result.status==='ERROR'?'bg-red':result.status==='WARNING'?'bg-yellow':'bg-green'}">${result.status}</span></header><div class="question-rich-content">${safeQuestionPreviewHtml(row.pertanyaan)}</div><div class="question-import-options">${options.map(key=>`<div><b>${key.toUpperCase()}.</b> <span>${safeQuestionPreviewHtml(row[`opsi_${key}`])}</span></div>`).join('')}</div><small>Kunci: ${escapeQuestionUiText(row.jawaban_benar)} · Bobot: ${escapeQuestionUiText(row.poin || 1)}</small>${notes?`<ul>${notes}</ul>`:''}</article>`;
  }).join('');
  modal.classList.add('show'); typesetQuestionMath(modal.querySelector('#questionImportPreviewList'));
}

function confirmQuestionImport() {
  if (!pendingQuestionImport || pendingQuestionImport.validation.some(item => item.status === 'ERROR')) return;
  const { rows, input } = pendingQuestionImport;
  document.getElementById('modalPreviewImportSoal')?.classList.remove('show');
  showLoading('Mengimport soal...');
    cbtApi
      .withSuccessHandler(res => {
        hideLoading();
        const details = (res.summary?.errors || []).slice(0, 5).map(error => `Baris ${error.row}: ${error.reason}`).join('\n');
        const failed = Number(res.summary?.failed || 0);
        showCustomAlert(failed ? 'Peringatan Hasil Import' : 'Import Soal Berhasil', res.message + (details ? `\n${details}` : ''), failed ? 'warning' : 'success');
        loadDataAdminSoal();
        input.value = '';
      })
      .withFailureHandler(err => {
        hideLoading();
        showCustomAlert('Import Gagal', err.message);
        input.value = '';
      })
      .importSoalBulk(stPengelola, rows);
}

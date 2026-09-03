// Administrator exam schedule management.
let cacheAdminUjianRows = [];

function formatTargetKelas(targetStr, targetNamesStr) {
  if (targetNamesStr && targetNamesStr.trim() !== '' && !targetNamesStr.startsWith('01M1')) {
    return targetNamesStr.split(',').map(s => s.trim()).join(', ');
  }
  if (!targetStr || targetStr.trim() === '' || targetStr.trim().toLowerCase() === 'semua') {
    return 'Semua Kelas';
  }
  const rawItems = targetStr.split(',').map(s => s.trim()).filter(Boolean);
  if (rawItems.length === 0) return 'Semua Kelas';

  if (!portalReferences || !portalReferences.classes || portalReferences.classes.length === 0) {
    return targetStr;
  }

  const classNames = rawItems.map(item => {
    const found = portalReferences.classes.find(c => 
      c.portal_class_id === item || 
      c.code === item || 
      c.name === item || 
      String(c.id) === item
    );
    return found ? (found.name || found.code) : item;
  });

  return classNames.join(', ');
}

function populateAdminUjianFilters() {
  const tingVal = document.getElementById('fltUjianTingkat')?.value || 'ALL';

  // Populate Rombel / Kelas Filter
  const fltKelas = document.getElementById('fltUjianKelas');
  if (fltKelas && portalReferences && portalReferences.classes) {
    const currentVal = fltKelas.value;
    const availableClasses = portalReferences.classes.filter(c => tingVal === 'ALL' || c.grade === tingVal);
    const sortedClasses = [...availableClasses].sort((a, b) => (a.name || a.code || '').localeCompare(b.name || b.code || '', undefined, { numeric: true }));
    fltKelas.innerHTML = `<option value="ALL">Semua Kelas</option>` + sortedClasses.map(c => `
      <option value="${c.portal_class_id}">${c.name || c.code}</option>
    `).join('');
    if (currentVal && sortedClasses.some(c => c.portal_class_id === currentVal)) {
      fltKelas.value = currentVal;
    } else {
      fltKelas.value = 'ALL';
    }
  }

  // Populate Mata Pelajaran Filter
  const fltMapel = document.getElementById('fltUjianMapel');
  if (fltMapel && portalReferences && portalReferences.subjects) {
    const currentVal = fltMapel.value;
    const sortedSubjects = [...portalReferences.subjects].sort((a, b) => (a.name || a.code || '').localeCompare(b.name || b.code || ''));
    fltMapel.innerHTML = `<option value="ALL">Semua Mata Pelajaran</option>` + sortedSubjects.map(s => `
      <option value="${s.id}">${s.code} — ${s.name}</option>
    `).join('');
    if (currentVal) fltMapel.value = currentVal;
  }
}

function applyFilterUjian() {
  const ting = document.getElementById('fltUjianTingkat')?.value || 'ALL';
  const kelas = document.getElementById('fltUjianKelas')?.value || 'ALL';
  const mapel = document.getElementById('fltUjianMapel')?.value || 'ALL';
  const query = (document.getElementById('searchUjian')?.value || '').toLowerCase().trim();

  const filtered = cacheAdminUjianRows.filter(u => {
    // Filter Tingkat
    if (ting !== 'ALL' && String(u.tingkat).toUpperCase() !== ting.toUpperCase()) {
      return false;
    }
    // Filter Kelas
    if (kelas !== 'ALL') {
      const targetStr = String(u.kelas_target || '').trim();
      const targetNames = String(u.nama_kelas_target || '').trim();
      if (targetStr && targetStr.toLowerCase() !== 'semua') {
        const ids = targetStr.split(',').map(s => s.trim());
        const names = targetNames.split(',').map(s => s.trim());
        const selectedClassObj = portalReferences.classes?.find(c => c.portal_class_id === kelas);
        const selectedClassName = selectedClassObj?.name || selectedClassObj?.code || '';
        const match = ids.includes(kelas) || (selectedClassName && (names.includes(selectedClassName) || ids.includes(selectedClassName)));
        if (!match) return false;
      }
    }
    // Filter Mapel
    if (mapel !== 'ALL') {
      const matchSubject = String(u.subject_id) === String(mapel) || 
                           (u.nama_mapel && portalReferences.subjects?.find(s => String(s.id) === String(mapel))?.name === u.nama_mapel);
      if (!matchSubject) return false;
    }
    // Search Query
    if (query !== '') {
      const formatted = formatTargetKelas(u.kelas_target, u.nama_kelas_target);
      const fullText = `${u.id} ${u.nama_ujian} ${u.nama_mapel || ''} ${u.tingkat} ${u.tanggal_ujian || ''} ${formatted} ${u.tahun_ajaran || ''}`.toLowerCase();
      if (!fullText.includes(query)) return false;
    }
    return true;
  });

  const tb = document.getElementById('tblAdminUjian');
  if (!tb) return;

  if (filtered.length === 0) {
    tb.innerHTML = `<tr><td colspan="8" align="center" style="padding:24px; color:var(--text-muted);">Tidak ada jadwal ujian yang sesuai kriteria filter.</td></tr>`;
    window.cacheUjianExcel = [];
    return;
  }

  window.cacheUjianExcel = filtered.map(u => [
    u.id, 
    u.nama_ujian, 
    u.tingkat, 
    u.sesi || 1, 
    u.tanggal_ujian || '', 
    formatTargetKelas(u.kelas_target, u.nama_kelas_target), 
    u.durasi_menit, 
    u.tahun_ajaran || '', 
    u.semester || '', 
    u.status_aktif ? 'AKTIF' : 'NONAKTIF'
  ]);

  tb.innerHTML = filtered.map(u => {
    const formattedKelas = formatTargetKelas(u.kelas_target, u.nama_kelas_target);
    return `
      <tr>
        <td><strong>#${u.id}</strong></td>
        <td>
          <div style="font-weight:700; color:var(--text-main); font-size:13px;">${u.nama_ujian}</div>
          <small style="color:var(--primary-dark); font-weight:600;"><i class="fa-solid fa-book-open" style="font-size:10px;"></i> ${u.nama_mapel || 'Mata Pelajaran'}</small>
        </td>
        <td><span class="badge bg-blue">Tingkat ${u.tingkat}</span></td>
        <td>
          <span class="badge bg-gray">Sesi ${u.sesi || 1}</span><br>
          <small style="color:var(--text-muted);"><i class="fa-regular fa-calendar"></i> ${u.tanggal_ujian || 'TBD'}</small>
        </td>
        <td>
          <span class="badge ${formattedKelas === 'Semua Kelas' ? 'bg-green' : 'bg-gray'}" style="max-width:200px; white-space:normal; line-height:1.35; text-align:left; display:inline-block;">
            ${formattedKelas}
          </span>
        </td>
        <td><small style="font-weight:700;">${u.tahun_ajaran || '2025/2026'}</small><br><small style="color:var(--text-muted);">Semester ${u.semester || 'Genap'}</small></td>
        <td><span class="badge ${u.status_aktif ? 'bg-green' : 'bg-red'}">${u.status_aktif ? 'AKTIF' : 'NONAKTIF'}</span></td>
        <td>
          <button class="btn btn-secondary" style="padding:5px 10px; font-size:11.5px;" onclick='editUjian(${JSON.stringify(u)})'>
            <i class="fa-solid fa-pen"></i> Edit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function loadDataAdminUjian() {
  loadPortalReferences(() => {
    populateAdminUjianFilters();
    applyFilterUjian();
  });
  const tb = document.getElementById('tblAdminUjian');
  if (tb) tb.innerHTML = `<tr><td colspan="8" align="center" style="padding:24px;">Memuat data jadwal ujian...</td></tr>`;

  cbtApi
    .withSuccessHandler(rows => {
      cacheAdminUjianRows = rows || [];
      populateAdminUjianFilters();
      applyFilterUjian();
    })
    .getAdminUjianList(stPengelola);
}

function bukaModalUjian(data = null) {
  if (!portalReferencesLoaded) {
    loadPortalReferences(() => bukaModalUjian(data));
    return;
  }
  document.getElementById('formUjian').reset();
  populateExamPortalOptions(data);
  if (data) {
    document.getElementById('titleModalUjian').textContent = "Edit Data Ujian & Arsip";
    document.getElementById('editUjianId').value = data.id;
    document.getElementById('inNamaUjian').value = data.nama_ujian;
    document.getElementById('inSubjectUjian').value = data.subject_id || '';
    document.getElementById('inTingkatUjian').value = data.tingkat;
    document.getElementById('inSesiUjian').value = data.sesi || 1;
    document.getElementById('inTanggalUjian').value = data.tanggal_ujian || '';
    document.getElementById('inJamMulai').value = data.jam_mulai || '07:00';
    document.getElementById('inJamSelesai').value = data.jam_selesai || '08:30';
    document.getElementById('inDurasiUjian').value = data.durasi_menit;
    document.getElementById('inTahunAjaran').value = data.portal_academic_year_id || '';
    refreshSemesterOptions(data.portal_semester_id || '');
    const selectedClasses = String(data.kelas_target || '').split(',').map(v => v.trim()).filter(Boolean);
    refreshClassOptions(selectedClasses);
    document.getElementById('inStatusUjian').value = String(data.status_aktif);
  } else {
    document.getElementById('titleModalUjian').textContent = "Tambah Ujian / Arsip Baru";
    document.getElementById('editUjianId').value = "";
    document.getElementById('inSesiUjian').value = "1";
    document.getElementById('inJamMulai').value = '07:00';
    document.getElementById('inJamSelesai').value = '08:30';
    refreshClassOptions([]);
  }
  document.getElementById('modalUjian').classList.add('show');
}

function editUjian(u) {
  bukaModalUjian(u);
}

document.getElementById('formUjian').addEventListener('submit', function (e) {
  e.preventDefault();
  const selectedClassOptions = Array.from(document.querySelectorAll('.cb-kelas-item:checked')).map(cb => cb.value);
  const payload = {
    id: document.getElementById('editUjianId').value || null,
    nama_ujian: document.getElementById('inNamaUjian').value,
    subject_id: document.getElementById('inSubjectUjian').value,
    tingkat: document.getElementById('inTingkatUjian').value,
    sesi: document.getElementById('inSesiUjian').value,
    tanggal_ujian: document.getElementById('inTanggalUjian').value,
    jam_mulai: document.getElementById('inJamMulai').value,
    jam_selesai: document.getElementById('inJamSelesai').value,
    kelas_target: selectedClassOptions.join(','),
    durasi_menit: document.getElementById('inDurasiUjian').value,
    portal_academic_year_id: document.getElementById('inTahunAjaran').value,
    portal_semester_id: document.getElementById('inSemester').value,
    status_aktif: document.getElementById('inStatusUjian').value
  };
  showLoading('Menyimpan Ujian...');
  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      if (res.success) {
        document.getElementById('modalUjian').classList.remove('show');
        loadDataAdminUjian();
      } else {
        showCustomAlert('Gagal', res.message);
      }
    })
    .withFailureHandler(err => {
      hideLoading();
      showCustomAlert('Error', err.message);
    })
    .simpanUjianAdmin(stPengelola, payload);
});

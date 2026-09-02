// Administrator exam schedule management.
function loadDataAdminUjian() {
  loadPortalReferences();
  const tb = document.getElementById('tblAdminUjian'); tb.innerHTML = `<tr><td colspan="8" align="center">Memuat...</td></tr>`;
  cbtApi
    .withSuccessHandler(rows => {
      if(!rows || rows.length === 0) { tb.innerHTML = `<tr><td colspan="8" align="center">Belum ada ujian.</td></tr>`; return; }
      window.cacheUjianExcel = rows.map(u => [u.id, u.nama_ujian, u.tingkat, u.sesi || 1, u.tanggal_ujian || '', u.kelas_target || '', u.durasi_menit, u.tahun_ajaran || '', u.semester || '', u.status_aktif]);
      tb.innerHTML = rows.map(u => `
        <tr>
          <td>${u.id}</td>
          <td><b>${u.nama_ujian}</b><br><small>${u.nama_mapel || 'Mapel belum dipilih'}</small></td>
          <td>${u.tingkat}</td>
          <td><span class="badge bg-gray">Sesi ${u.sesi || 1}</span><br><small style="color:var(--text-muted);"><i class="fa-regular fa-calendar"></i> ${u.tanggal_ujian || 'TBD'}</small></td>
          <td><span class="badge bg-gray">${u.kelas_target || 'Semua'}</span></td>
          <td>${u.tahun_ajaran || '2025/2026'} (${u.semester || 'Genap'})</td>
          <td><span class="badge ${u.status_aktif?'bg-green':'bg-red'}">${u.status_aktif?'AKTIF':'NONAKTIF'}</span></td>
          <td><button class="btn btn-secondary" style="padding:4px 10px; font-size:11px;" onclick='editUjian(${JSON.stringify(u)})'><i class="fa-solid fa-pen"></i> Edit</button></td>
        </tr>`).join('');
    })
    .getAdminUjianList(stPengelola);
}

function bukaModalUjian(data = null) {
  if (!portalReferencesLoaded) { loadPortalReferences(() => bukaModalUjian(data)); return; }
  document.getElementById('formUjian').reset();
  populateExamPortalOptions(data);
  if(data) {
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
    const selectedClasses = String(data.kelas_target || '').split(',').map(v => v.trim());
    refreshClassOptions(selectedClasses);
    document.getElementById('inStatusUjian').value = String(data.status_aktif);
  } else {
    document.getElementById('titleModalUjian').textContent = "Tambah Ujian / Arsip Baru";
    document.getElementById('editUjianId').value = "";
    document.getElementById('inSesiUjian').value = "1";
    document.getElementById('inJamMulai').value = '07:00';
    document.getElementById('inJamSelesai').value = '08:30';
  }
  document.getElementById('modalUjian').classList.add('show');
}
function editUjian(u) { bukaModalUjian(u); }

document.getElementById('formUjian').addEventListener('submit', function(e){
  e.preventDefault();
  const payload = {
    id: document.getElementById('editUjianId').value || null,
    nama_ujian: document.getElementById('inNamaUjian').value,
    subject_id: document.getElementById('inSubjectUjian').value,
    tingkat: document.getElementById('inTingkatUjian').value,
    sesi: document.getElementById('inSesiUjian').value,
    tanggal_ujian: document.getElementById('inTanggalUjian').value,
    jam_mulai: document.getElementById('inJamMulai').value,
    jam_selesai: document.getElementById('inJamSelesai').value,
    kelas_target: Array.from(document.getElementById('inKelasTarget').selectedOptions).map(o => o.value).join(','),
    durasi_menit: document.getElementById('inDurasiUjian').value,
    portal_academic_year_id: document.getElementById('inTahunAjaran').value,
    portal_semester_id: document.getElementById('inSemester').value,
    status_aktif: document.getElementById('inStatusUjian').value
  };
  showLoading('Menyimpan Ujian...');
  cbtApi
    .withSuccessHandler(res => { 
      hideLoading(); 
      if(res.success){ 
        document.getElementById('modalUjian').classList.remove('show'); 
        loadDataAdminUjian(); 
      } else {
        showCustomAlert('Gagal', res.message);
      }
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .simpanUjianAdmin(stPengelola, payload);
});

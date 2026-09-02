
let stSiswa = { id: null, nama: '', kelas: '', no: '' };
let stUjian = { id: null, nama: '', durasi: 0 };
let stSoal = [];
let stJawab = {};
let stRagu = {};
let stIdx = 0;
let tmrUjian = null;
let isUjianJalan = false;
let isSubmitting = false;
let antiCheatAttached = false;
let stPengelola = { userId: null, id: null, role: null, nama: '', username: '' };
let cacheHasilRaw = [];
let cacheSiswaGlobal = [];
let portalReferences = { teachers: [], subjects: [], classes: [], academic_years: [], semesters: [] };
let portalReferencesLoaded = false;

function showLoading(msg = 'Memuat...') { document.getElementById('loaderText').textContent = msg; document.getElementById('loaderGlobal').classList.add('show'); }
function hideLoading() { document.getElementById('loaderGlobal').classList.remove('show'); }

function showCustomAlert(title, message) {
  document.getElementById('alertTitle').textContent = title;
  document.getElementById('alertMessage').textContent = message;
  document.getElementById('modalCustomAlert').classList.add('show');
}

function showCustomConfirm(title, message, onYes) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  const modal = document.getElementById('modalCustomConfirm');
  modal.classList.add('show');
  
  const btnYes = document.getElementById('btnConfirmYa');
  const btnBatal = document.getElementById('btnConfirmBatal');
  
  const newBtnYes = btnYes.cloneNode(true);
  const newBtnBatal = btnBatal.cloneNode(true);
  btnYes.parentNode.replaceChild(newBtnYes, btnYes);
  btnBatal.parentNode.replaceChild(newBtnBatal, btnBatal);
  
  newBtnYes.addEventListener('click', () => {
    modal.classList.remove('show');
    if(typeof onYes === 'function') onYes();
  });
  newBtnBatal.addEventListener('click', () => {
    modal.classList.remove('show');
  });
}

function switchView(viewId) {
  ['viewLoginSiswa', 'viewPortalSiswa', 'viewRuangUjian', 'viewHasilSiswa', 'viewDashboardPengelola'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  document.getElementById(viewId).classList.remove('hidden');
}

function appResetLogout() {
  if (typeof window.cbtServerLogout === 'function') window.cbtServerLogout();
  stSiswa = { id: null }; stUjian = { id: null }; stSoal = []; stJawab = {}; stRagu = {}; stIdx = 0;
  isUjianJalan = false; isSubmitting = false; clearInterval(tmrUjian);
  stPengelola = { userId: null, id: null, role: null, nama: '', username: '' };
  
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
  document.getElementById('formLoginSiswa').reset();
  document.getElementById('formLoginPengelola').reset();
  document.getElementById('alertLoginSiswa').className = 'alert';
  document.getElementById('alertLoginPengelola').className = 'alert';
  
  switchView('viewLoginSiswa');
}

function filterTable(tableId, query) {
  const q = query.toLowerCase();
  const trs = document.querySelectorAll(`#${tableId} tr`);
  trs.forEach(tr => {
    const text = tr.textContent.toLowerCase();
    tr.style.display = text.includes(q) ? '' : 'none';
  });
}

document.getElementById('formLoginSiswa').addEventListener('submit', function(e) {
  e.preventDefault();
  const no = document.getElementById('inNoUjian').value;
  const pin = document.getElementById('inPin').value;
  const alert = document.getElementById('alertLoginSiswa'); alert.className = 'alert';
  
  showLoading('Verifikasi Kredensial...');
  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      if (!res.success) { alert.className = 'alert error'; alert.textContent = res.message; return; }
      
      stSiswa = { id: res.siswa.id, nama: res.siswa.nama, kelas: res.siswa.kelas, no: res.siswa.nomor_ujian };
      document.getElementById('lblNamaSiswa').textContent = stSiswa.nama;
      document.getElementById('lblKelasSiswa').textContent = stSiswa.kelas;
      document.getElementById('lblNoSiswa').textContent = stSiswa.no;
      
      renderDaftarJadwal(res.jadwal);
      switchView('viewPortalSiswa');
    })
    .withFailureHandler(err => {
      hideLoading();
      alert.className = 'alert error'; alert.textContent = 'Gagal terhubung ke server: ' + err.message;
    })
    .loginSiswaAPI(no, pin);
});

function renderDaftarJadwal(jadwalArr) {
  const container = document.getElementById('listJadwalUjian');
  if (!jadwalArr || jadwalArr.length === 0) {
    container.innerHTML = `<div class="alert error" style="display:block; margin:0;"><i class="fa-solid fa-circle-info"></i> Tidak ada jadwal ujian aktif untuk kelas/tingkat Anda saat ini.</div>`;
    return;
  }
  
  container.innerHTML = jadwalArr.map(j => {
    let btnHtml = '', cardClass = '';
    if (j.status_pengerjaan === 'selesai') {
      cardClass = 'style="opacity:0.6; background:var(--secondary-bg);"';
      btnHtml = `<button class="btn btn-secondary" style="padding:8px 16px; font-size:12px; width:auto;" disabled><i class="fa-solid fa-check"></i> Selesai</button>`;
    } else if (j.status_pengerjaan === 'terblokir') {
      cardClass = 'style="border-color:var(--danger); background:#fef2f2;"';
      btnHtml = `<button class="btn btn-danger" style="padding:8px 16px; font-size:12px; width:auto;" disabled><i class="fa-solid fa-lock"></i> Terblokir</button>`;
    } else {
      btnHtml = `<button class="btn btn-success" style="padding:8px 16px; font-size:12px; width:auto;" onclick='persiapkanUjian(${JSON.stringify(j)})'><i class="fa-solid fa-play"></i> Mulai Ujian</button>`;
    }
    return `
      <div class="card" ${cardClass} style="display:flex; justify-content:space-between; align-items:center; padding:16px; margin:0;">
        <div>
          <h4 style="font-size:14px; font-weight:800; color:var(--text-main); margin-bottom:4px;">${j.nama_ujian}</h4>
          <p style="font-size:11px; color:var(--text-muted);"><i class="fa-regular fa-calendar-days"></i> Tanggal: <b>${j.tanggal_ujian || 'TBD'}</b> | Sesi ${j.sesi} | Durasi: ${j.durasi_menit}m</p>
        </div>
        <div>${btnHtml}</div>
      </div>
    `;
  }).join('');
}

function rngSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 16777619); }
  return h >>> 0;
}
function acakArray(arr, seed) {
  let res = [...arr], m = seed;
  for (let i = res.length - 1; i > 0; i--) {
    m = (Math.imul(m, 1103515245) + 12345) & 0x7fffffff;
    let j = m % (i + 1);
    [res[i], res[j]] = [res[j], res[i]];
  }
  return res;
}

function persiapkanUjian(uData) {
  showLoading('Mempersiapkan Lembar Soal...');
  stUjian = uData;
  
  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      if(!res.success) { showCustomAlert('Gagal', res.message); return; }
      
      const soalRaw = res.soal;
      const jawRaw = res.jawaban;
      
      const seedSoal = rngSeed(String(stSiswa.id) + "_" + String(uData.id));
      stSoal = (res.serverOrdered ? soalRaw : acakArray(soalRaw, seedSoal)).map((s, i) => {
        let rawOpts = s.opsi || [
          { key: 'A', text: s.opsi_a }, { key: 'B', text: s.opsi_b },
          { key: 'C', text: s.opsi_c }, { key: 'D', text: s.opsi_d },
          { key: 'E', text: s.opsi_e }
        ].filter(o => o.text && o.text.trim() !== '');
        
        const seedOpsi = rngSeed(String(stSiswa.id) + "_" + String(s.id));
        return { id: s.id, num: i + 1, q: s.pertanyaan, opts: res.serverOrdered ? rawOpts : acakArray(rawOpts, seedOpsi) };
      });
      
      stJawab = {}; stRagu = {}; (jawRaw||[]).forEach(j => {
        if (j.jawaban) stJawab[j.soal_id] = j.jawaban;
        if (j.ragu) stRagu[j.soal_id] = true;
      });
      stIdx = 0;
      
      document.getElementById('cbtMapel').textContent = uData.nama_ujian;
      document.getElementById('cbtNama').textContent = stSiswa.nama;
      document.getElementById('cbtNo').textContent = stSiswa.no;
      
      switchView('viewRuangUjian');
      isUjianJalan = true;
      
      renderGridNav(); renderSoal();
      const serverNow = res.serverTime ? Date.parse(res.serverTime) : Date.now();
      const clockOffset = Number.isFinite(serverNow) ? serverNow - Date.now() : 0;
      mulaiTimerCBT(res.expiresAt ? Date.parse(res.expiresAt) : Date.now() + (uData.durasi_menit * 60000), clockOffset);
      aktifkanAntiCheat();
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error Koneksi', err.message); })
    .getServerSoal(uData.id, stSiswa.id);
}

function renderGridNav() {
  document.getElementById('cbtNavGrid').innerHTML = stSoal.map((s, i) => {
    let cls = 'btn-num';
    if(i === stIdx) cls += ' active';
    if(stJawab[s.id]) cls += ' answered';
    if(stRagu[s.id]) cls += ' flagged';
    return `<button class="${cls}" onclick="stIdx=${i}; renderSoal(); renderGridNav();">${i+1}</button>`;
  }).join('');
}

function navigasiSoal(dir) {
  let newIdx = stIdx + dir;
  if(newIdx >= 0 && newIdx < stSoal.length) { stIdx = newIdx; renderSoal(); renderGridNav(); }
}

function toggleRagu() {
  let sId = stSoal[stIdx].id;
  stRagu[sId] = !stRagu[sId];
  renderSoal(); renderGridNav();
  cbtApi.simpanJawabanServer({ siswaId: stSiswa.id, ujianId: stUjian.id, soalId: sId, jawaban: stJawab[sId] || null, ragu: stRagu[sId] });
}

function renderSoal() {
  const s = stSoal[stIdx];
  document.getElementById('cbtSoalNum').textContent = `Soal ${stIdx + 1}`;
  document.getElementById('cbtSoalText').textContent = s.q;
  
  const btnR = document.getElementById('btnRagu');
  if(stRagu[s.id]) { btnR.className = 'btn btn-warning'; btnR.innerHTML = '<i class="fa-solid fa-flag"></i> Ragu (✔)'; }
  else { btnR.className = 'btn btn-secondary'; btnR.innerHTML = '<i class="fa-regular fa-flag"></i> Ragu-ragu'; }
  
  const svd = stJawab[s.id] || '';
  document.getElementById('cbtOptionList').innerHTML = s.opts.map((opt, i) => {
    const visualLabel = String.fromCharCode(65 + i);
    const cls = svd === opt.key ? 'selected' : '';
    return `<div class="opt-btn ${cls}" onclick="simpanJawaban('${s.id}','${opt.key}', ${stIdx + 1})">
      <div class="opt-char">${visualLabel}</div><div class="opt-text">${opt.text}</div>
    </div>`;
  }).join('');
}

function simpanJawaban(soalId, originalKey, nomorSoal) {
  stJawab[soalId] = originalKey;
  renderSoal(); renderGridNav();
  document.getElementById('cbtSaveStatus').textContent = 'Menyimpan...';
  
  cbtApi
    .withSuccessHandler(res => { document.getElementById('cbtSaveStatus').textContent = res.success ? 'Tersimpan' : 'Gagal simpan'; })
    .withFailureHandler(() => { document.getElementById('cbtSaveStatus').textContent = 'Tersimpan Lokal'; })
    .simpanJawabanServer({ siswaId: stSiswa.id, ujianId: stUjian.id, soalId: soalId, jawaban: originalKey, ragu: !!stRagu[soalId], nomorUjian: stSiswa.no, namaSiswa: stSiswa.nama, kelas: stSiswa.kelas, nomorSoal: nomorSoal });
}

function mulaiTimerCBT(endTimeMs, clockOffset = 0) {
  clearInterval(tmrUjian);
  const tb = document.getElementById('cbtTimerBox'), tt = document.getElementById('cbtTimer');
  tmrUjian = setInterval(() => {
    let sisaS = Math.floor((endTimeMs - (Date.now() + clockOffset)) / 1000);
    if(sisaS <= 0) { clearInterval(tmrUjian); tt.textContent = "00:00"; showCustomAlert('Waktu Habis', 'Waktu ujian telah habis!'); prosesKumpulFinal(); return; }
    if(sisaS <= 300) tb.classList.add('danger'); else tb.classList.remove('danger');
    tt.textContent = `${String(Math.floor(sisaS / 60)).padStart(2,'0')}:${String(sisaS % 60).padStart(2,'0')}`;
  }, 1000);
}

function aktifkanAntiCheat() {
  if (antiCheatAttached) return;
  antiCheatAttached = true;
  document.addEventListener('visibilitychange', () => {
    if(document.hidden && isUjianJalan && !isSubmitting) {
      cbtApi
        .withSuccessHandler(res => {
          if(!res.success) return;
          if(res.dihentikan) {
            isUjianJalan = false; clearInterval(tmrUjian);
            document.getElementById('txtPelanggaran').textContent = "Ujian Anda dihentikan karena terdeteksi 3x keluar aplikasi.";
            document.getElementById('btnPahamPelanggaran').onclick = appResetLogout;
            document.getElementById('modalPelanggaran').classList.add('show');
            if(res.hasil) { document.getElementById('modalPelanggaran').classList.remove('show'); document.getElementById('lblNilaiAkhir').textContent = res.hasil.nilai; switchView('viewHasilSiswa'); }
          } else {
            document.getElementById('txtPelanggaran').textContent = `Peringatan (${res.jumlah}/3): Anda keluar dari aplikasi CBT.`;
            document.getElementById('btnPahamPelanggaran').onclick = () => document.getElementById('modalPelanggaran').classList.remove('show');
            document.getElementById('modalPelanggaran').classList.add('show');
          }
        })
        .catatPelanggaranServer(stSiswa.id, stUjian.id);
    }
  });
}

function bukaModalSubmit() {
  let sisaKosong = stSoal.length - Object.keys(stJawab).length;
  document.getElementById('txtConfirmSubmit').innerHTML = sisaKosong > 0 ? `Masih ada <strong style="color:var(--danger)">${sisaKosong} soal kosong</strong>. Kumpulkan?` : "Semua soal terjawab. Kumpulkan ujian?";
  document.getElementById('modalSubmitUjian').classList.add('show');
}

function prosesKumpulFinal() { submitUjianKeServer(); }

function submitUjianKeServer() {
  document.getElementById('modalSubmitUjian').classList.remove('show');
  isSubmitting = true; isUjianJalan = false; clearInterval(tmrUjian);
  showLoading('Menghitung nilai...');
  
  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      if(res.success) { document.getElementById('lblNilaiAkhir').textContent = res.hasil.nilai; switchView('viewHasilSiswa'); }
      else showCustomAlert('Gagal Submit', res.message);
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .submitUjian({ siswa_id: stSiswa.id, ujian_id: stUjian.id });
}

function bukaModalReview() {
  showLoading('Memuat review...');
  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      if (!res.success) { showCustomAlert('Gagal', res.message); return; }
      const jawMap = {}; (res.jawaban||[]).forEach(j => { jawMap[j.soal_id] = String(j.jawaban).trim().toUpperCase(); });
      
      document.getElementById('listReviewContainer').innerHTML = res.soal.map((s, idx) => {
        const jSiswa = jawMap[s.id] || '';
        const kBenar = String(s.jawaban_benar || '').trim().toUpperCase();
        let st = '<span style="color:var(--danger); font-weight:700;">[TIDAK DIJAWAB]</span>';
        if (jSiswa) {
          st = jSiswa === kBenar ? '<span style="color:var(--success); font-weight:700;"><i class="fa-solid fa-check"></i> [BENAR]</span>' : '<span style="color:var(--danger); font-weight:700;"><i class="fa-solid fa-xmark"></i> [SALAH]</span>';
        }
        return `<div style="background:var(--secondary-bg); border:1px solid var(--border); border-radius:8px; padding:14px; font-size:12px;"><div style="display:flex; justify-content:space-between; margin-bottom:6px;"><b style="color:var(--primary);">Soal No. ${idx + 1}</b><div>${st}</div></div><div>${s.pertanyaan}</div></div>`;
      }).join('');
      document.getElementById('modalReview').classList.add('show');
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .getReviewUjianServer(stSiswa.id, stUjian.id);
}

function exportToExcel(filename, sheetName, headers, dataRows) {
  if (!dataRows || dataRows.length === 0) { showCustomAlert('Peringatan', 'Tidak ada data untuk diexport.'); return; }
  let wsData = [headers, ...dataRows];
  let wb = XLSX.utils.book_new();
  let ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

function downloadTemplateSiswa() {
  let headers = ['nisn', 'nama', 'kelas', 'tingkat', 'pin', 'tahun_ajaran'];
  let sampleData = [
    ['0091234567', 'Ahmad Fulan', 'X MIPA 1', 'X', '', '2025/2026'],
    ['0087654321', 'Budi Santoso', 'XI IPA 1', 'XI', '', '2025/2026']
  ];
  exportToExcel('template_siswa.xlsx', 'Template Siswa', headers, sampleData);
}

function downloadTemplateSoal() {
  let headers = ['nama_ujian', 'pertanyaan', 'opsi_a', 'opsi_b', 'opsi_c', 'opsi_d', 'opsi_e', 'jawaban_benar', 'poin'];
  let sampleData = [['Kimia Kelas XII', 'Berapakah hasil dari 2 + 2?', '2', '3', '4', '5', '6', 'C', 1]];
  exportToExcel('template_soal.xlsx', 'Template Soal', headers, sampleData);
}

function downloadTemplateAkun() {
  let headers = ['username', 'nama_lengkap', 'role', 'password'];
  let sampleData = [['guru_kimia', 'Dra. Hj. Nurul', 'guru', '123456']];
  exportToExcel('template_akun_pengguna.xlsx', 'Template Akun', headers, sampleData);
}

function handleExcelUpload(input, callback) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
      callback(json);
    } catch (err) {
      showCustomAlert('Gagal', 'Gagal membaca file Excel: ' + err.message);
      input.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

document.getElementById('formLoginPengelola').addEventListener('submit', function(e){
  e.preventDefault();
  const u = document.getElementById('inUserPengelola').value;
  const p = document.getElementById('inPassPengelola').value;
  const alert = document.getElementById('alertLoginPengelola'); alert.className = 'alert';
  
  showLoading('Otentikasi...');
  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      if(res && res.success) {
        document.getElementById('modalLoginPengelola').classList.remove('show');
        stPengelola = { userId: res.userId || res.id, id: res.userId || res.id, role: res.role, nama: res.nama, username: u };
        initDashboardPengelola(res.nama, res.role);
      } else { alert.className = 'alert error'; alert.textContent = res?.message || 'Gagal login.'; }
    })
    .withFailureHandler(err => { hideLoading(); alert.className = 'alert error'; alert.textContent = 'Error: ' + err.message; })
    .loginPenggunaAPI(u, p);
});

function initDashboardPengelola(nama, role) {
  const cleanRole = String(role || 'guru').toLowerCase().trim();
  document.getElementById('lblRolePengelola').textContent = cleanRole === 'admin' ? 'ADMINISTRATOR' : 'GURU MATA PELAJARAN';
  document.getElementById('lblNamaPengelola').textContent = nama;
  document.getElementById('lblIdentitasPengelola').textContent = `User: @${stPengelola.username}`;
  
  document.getElementById('menuAdmin').classList.add('hidden');
  document.getElementById('menuGuru').classList.add('hidden');
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.add('hidden'));

  if (cleanRole === 'admin') {
    document.getElementById('menuAdmin').classList.remove('hidden');
    document.getElementById('tabAdminOverview').classList.remove('hidden');
    loadDataAdminDash();
  } else {
    document.getElementById('menuGuru').classList.remove('hidden');
    document.getElementById('tabGuruMonitor').classList.remove('hidden');
    loadDataGuru();
  }
  switchView('viewDashboardPengelola');
}

function switchDashTab(tabId, btnEl) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.add('hidden'));
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  
  if(tabId === 'tabAdminOverview') loadDataAdminDash();
  if(tabId === 'tabAdminUjian') loadDataAdminUjian();
  if(tabId === 'tabAdminSoal') loadDataAdminSoal();
  if(tabId === 'tabAdminSiswa') loadDataAdminSiswa();
  if(tabId === 'tabAdminLogPelanggaran') loadDataAdminLogPelanggaran();
  if(tabId === 'tabAdminHasil') loadDataAdminHasil();
  if(tabId === 'tabAdminKartu') loadDataAdminKartu();
  if(tabId === 'tabAdminGuruUjian') loadDataAdminGuruUjian();
  if(tabId === 'tabAdminAkun') loadDataAdminAkun();
  if(tabId === 'tabGuruMonitor') loadDataGuru();
}

function loadDataAdminDash() {
  cbtApi
    .withSuccessHandler(res => {
      if(res && res.success){
        document.getElementById('statJmlSiswa').textContent = res.totalSiswa;
        document.getElementById('statJmlUjian').textContent = res.totalUjianAktif;
        document.getElementById('statJmlSubmit').textContent = res.totalSubmit;
        document.getElementById('statJmlPelanggaran').textContent = res.totalPelanggaran || 0;
      }
    })
    .getAdminDashboardStats(stPengelola);
}

function loadPortalReferences(onReady) {
  cbtApi.withSuccessHandler(res => {
    if (res.success) { portalReferences = res; portalReferencesLoaded = true; }
    if (typeof onReady === 'function') onReady(portalReferences);
  }).withFailureHandler(err => showCustomAlert('Referensi Portal Data', err.message)).getPortalDataReferences();
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await fetch('api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload.success) return;
    const staff = payload.data.staff;
    const student = payload.data.student;
    if (staff?.role === 'TEACHER') { window.location.replace('guru/dashboard'); return; }
    if (staff?.role === 'ADMIN') {
      stPengelola = { userId: staff.id, id: staff.id, role: 'admin', nama: staff.nama, username: staff.username };
      initDashboardPengelola(staff.nama, 'admin');return;
    }
    if (student) {
      stSiswa = { id: student.id, nama: student.nama, kelas: student.kelas, no: student.nisn };
      document.getElementById('lblNamaSiswa').textContent = stSiswa.nama;
      document.getElementById('lblKelasSiswa').textContent = stSiswa.kelas;
      document.getElementById('lblNoSiswa').textContent = stSiswa.no;
      cbtApi.withSuccessHandler(result => {
        renderDaftarJadwal(result.jadwal);switchView('viewPortalSiswa');
        const active = result.jadwal.find(exam => exam.status_pengerjaan === 'berlangsung');
        if (active) persiapkanUjian(active);
      }).withFailureHandler(() => switchView('viewPortalSiswa')).getStudentExamsAPI();
    }
  } catch (_) { /* Guest atau server belum siap: pertahankan layar login. */ }
});

function populateExamPortalOptions(data = null) {
  document.getElementById('inSubjectUjian').innerHTML = portalReferences.subjects.map(s => `<option value="${s.id}">${s.code} — ${s.name}</option>`).join('');
  const grades = [...new Set(portalReferences.classes.map(c => c.grade).filter(Boolean))];
  document.getElementById('inTingkatUjian').innerHTML = grades.map(g => `<option value="${g}">${g}</option>`).join('');
  document.getElementById('inTahunAjaran').innerHTML = portalReferences.academic_years.map(y => `<option value="${y.portal_academic_year_id}">${y.name}${Number(y.is_active) ? ' (Aktif)' : ''}</option>`).join('');
  const activeYear = portalReferences.academic_years.find(y => Number(y.is_active));
  if (!data && activeYear) document.getElementById('inTahunAjaran').value = activeYear.portal_academic_year_id;
  refreshSemesterOptions(data?.portal_semester_id || '');
  refreshClassOptions();
}

function refreshClassOptions(selected = []) {
  const grade = document.getElementById('inTingkatUjian').value;
  const year = portalReferences.academic_years.find(y => y.portal_academic_year_id === document.getElementById('inTahunAjaran').value)?.name;
  const classes = portalReferences.classes.filter(c => (!grade || c.grade === grade) && (!year || c.academic_year === year));
  document.getElementById('inKelasTarget').innerHTML = classes.map(c => `<option value="${c.portal_class_id}"${selected.includes(c.portal_class_id) ? ' selected' : ''}>${c.code} — ${c.name}</option>`).join('');
}

function refreshSemesterOptions(selected = '') {
  const yearId = document.getElementById('inTahunAjaran').value;
  const semesters = portalReferences.semesters.filter(s => s.portal_academic_year_id === yearId);
  document.getElementById('inSemester').innerHTML = semesters.map(s => `<option value="${s.portal_semester_id}">${s.type === 'ODD' ? 'Ganjil' : 'Genap'}${Number(s.is_active) ? ' (Aktif)' : ''}</option>`).join('');
  if (selected) document.getElementById('inSemester').value = selected;
}

document.getElementById('inTahunAjaran').addEventListener('change', () => { refreshSemesterOptions(); refreshClassOptions(); });
document.getElementById('inTingkatUjian').addEventListener('change', () => refreshClassOptions());

function sinkronkanSemuaPortalData() {
  const types = ['academic_years', 'semesters', 'classes', 'students', 'teachers'];
  const summaries = [];
  showLoading('Sinkronisasi referensi Portal Data...');
  const next = index => {
    if (index >= types.length) {
      hideLoading(); loadPortalReferences(); loadDataAdminSiswa();
      showCustomAlert('Sinkronisasi selesai', summaries.map(s => `${s.type}: ${s.total || 0} data`).join('\n'));
      return;
    }
    cbtApi.withSuccessHandler(res => { summaries.push({ type: types[index], ...res }); next(index + 1); })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Sinkronisasi gagal', `${types[index]}: ${err.message}`); })
      .syncPortalData(types[index]);
  };
  next(0);
}

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

function loadDataAdminSiswa() {
  const tb = document.getElementById('tblAdminSiswa'); tb.innerHTML = `<tr><td colspan="7" align="center">Memuat data siswa...</td></tr>`;
  cbtApi
    .withSuccessHandler(rows => {
      if(!rows || rows.length===0) { tb.innerHTML=`<tr><td colspan="7" align="center">Tidak ada data siswa.</td></tr>`; return; }
      cacheSiswaGlobal = rows;
      window.cacheSiswaExcel = rows.map(s => [s.nomor_ujian, s.nama, s.kelas, s.tingkat, s.pin, s.tahun_ajaran || '', s.status_aktif]);
      tb.innerHTML = rows.map(s => {
        let bSt = s.ujian_status==='dihentikan'?'bg-red':'bg-gray';
        let actBtn = s.ujian_status==='dihentikan' ? `<button class="btn btn-success" style="padding:4px 8px; font-size:11px;" onclick="bukaBlokirAdmin(${s.id})"><i class="fa-solid fa-unlock"></i> Buka</button>` : `<span style="color:var(--text-muted); font-size:11px;">Normal</span>`;
        return `<tr>
          <td><b>${s.nomor_ujian}</b></td>
          <td>${s.nama}</td>
          <td>${s.kelas}</td>
          <td><span class="badge bg-gray">${s.tingkat}</span></td>
          <td><code style="background:var(--secondary-bg); padding:2px 6px; border-radius:4px; font-weight:700;">${s.pin}</code></td>
          <td><span class="badge ${bSt}">${(s.ujian_status||'belum').toUpperCase()}</span></td>
          <td style="display:flex; gap:6px;">
            ${actBtn}
            <button class="btn btn-primary" style="padding:4px 8px; font-size:11px;" onclick="generatePinAdmin(${s.id})"><i class="fa-solid fa-key"></i> Generate PIN</button>
          </td>
        </tr>`;
      }).join('');
    })
    .getAdminSiswaList(stPengelola);
}

function generatePinAdmin(id) {
  showLoading('Membuat PIN siswa...');
  cbtApi.withSuccessHandler(res => { hideLoading(); loadDataAdminSiswa(); showCustomAlert('PIN berhasil dibuat', `PIN siswa: ${res.pin}`); })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Gagal', err.message); })
    .simpanSiswaSatuanAdmin(stPengelola, { id, pin: '' });
}

function bukaModalSiswaSatuan(data = null) {
  document.getElementById('formSiswaSatuan').reset();
  if(data) {
    document.getElementById('titleModalSiswa').textContent = "Edit Data Siswa";
    document.getElementById('editSiswaId').value = data.id;
    document.getElementById('inSiswaNo').value = data.nomor_ujian;
    document.getElementById('inSiswaNama').value = data.nama;
    document.getElementById('inSiswaKelas').value = data.kelas;
    document.getElementById('inSiswaTingkat').value = data.tingkat;
    document.getElementById('inSiswaPin').value = data.pin;
    document.getElementById('inSiswaThn').value = data.tahun_ajaran || '2025/2026';
  } else {
    document.getElementById('titleModalSiswa').textContent = "Tambah Siswa / Manual";
    document.getElementById('editSiswaId').value = "";
  }
  document.getElementById('modalSiswaSatuan').classList.add('show');
}
function editSiswaSatuan(s) { bukaModalSiswaSatuan(s); }

document.getElementById('formSiswaSatuan').addEventListener('submit', function(e){
  e.preventDefault();
  const payload = {
    id: document.getElementById('editSiswaId').value || null,
    nomor_ujian: document.getElementById('inSiswaNo').value,
    nama: document.getElementById('inSiswaNama').value,
    kelas: document.getElementById('inSiswaKelas').value,
    tingkat: document.getElementById('inSiswaTingkat').value,
    pin: document.getElementById('inSiswaPin').value,
    tahun_ajaran: document.getElementById('inSiswaThn').value
  };
  showLoading('Menyimpan siswa...');
  cbtApi
    .withSuccessHandler(res => { 
      hideLoading(); 
      if(res.success){ 
        document.getElementById('modalSiswaSatuan').classList.remove('show'); 
        loadDataAdminSiswa(); 
      } else {
        showCustomAlert('Gagal', res.message);
      }
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .simpanSiswaSatuanAdmin(stPengelola, payload);
});

function hapusSiswaAdmin(id) {
  showCustomConfirm("Konfirmasi Hapus Siswa", "Yakin ingin menghapus siswa ini dari sistem?", () => {
    showLoading('Menghapus siswa...');
    cbtApi
      .withSuccessHandler(res => { 
        hideLoading(); 
        if(res.success) loadDataAdminSiswa(); 
        else showCustomAlert('Gagal', res.message);
      })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
      .hapusSiswaAdmin(stPengelola, id);
  });
}

function handleImportSiswa(input) {
  handleExcelUpload(input, function(rows) {
    if (rows.length === 0) { showCustomAlert('Peringatan', 'File Excel siswa kosong.'); return; }
    showLoading(`Mengimport ${rows.length} siswa ke server...`);
    cbtApi
      .withSuccessHandler(res => { hideLoading(); showCustomAlert('Informasi', res.message); loadDataAdminSiswa(); input.value = ''; })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Import Gagal', err.message); input.value = ''; })
      .importSiswaBulk(stPengelola, rows);
  });
}

function prosesKenaikanKelas() {
  showCustomConfirm("Kenaikan Kelas & Arsip Siswa XII", "Proses ini akan menaikkan kelas seluruh siswa (X ➔ XI, XI ➔ XII). Data siswa kelas XII akan didownload dulu ke Excel sebagai arsip, lalu dibersihkan dari sistem. Lanjutkan?", () => {
    showLoading('Memproses kenaikan kelas & mengunduh arsip kelas XII...');
    cbtApi
      .withSuccessHandler(res => { 
        hideLoading(); 
        if(res.success) {
          if (res.dataXII && res.dataXII.length > 0) {
            let headers = ['Nomor Ujian', 'Nama Siswa', 'Kelas', 'Tingkat', 'PIN', 'Tahun Ajaran'];
            let rows = res.dataXII.map(s => [s.nomor_ujian, s.nama, s.kelas, s.tingkat, s.pin, s.tahun_ajaran]);
            exportToExcel('arsip_kelulusan_kelas_XII.xlsx', 'Arsip Kelas XII', headers, rows);
          }
          showCustomAlert('Sukses', res.message);
          loadDataAdminSiswa(); 
        } else {
          showCustomAlert('Gagal', res.message);
        }
      })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
      .prosesKenaikanKelasAdmin(stPengelola);
  });
}

function bukaModalHapusPertingkat() {
  document.getElementById('modalHapusPertingkat').classList.add('show');
}

function eksekusiHapusPertingkat() {
  const t = document.getElementById('selectTingkatHapus').value;
  document.getElementById('modalHapusPertingkat').classList.remove('show');
  showCustomConfirm("Hapus Per Tingkat", `Yakin ingin menghapus seluruh siswa tingkat ${t}?`, () => {
    showLoading(`Menghapus siswa tingkat ${t}...`);
    cbtApi
      .withSuccessHandler(res => { 
        hideLoading(); 
        if(res.success) loadDataAdminSiswa(); 
        else showCustomAlert('Gagal', res.message);
      })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
      .hapusSiswaPertingkatAdmin(stPengelola, t);
  });
}

function bukaBlokirAdmin(id) {
  showCustomConfirm("Buka Blokir", "Buka blokir dan reset status ujian siswa ini?", () => {
    showLoading('Membuka akses...');
    cbtApi
      .withSuccessHandler(res => { 
        hideLoading(); 
        if(res.success) loadDataAdminSiswa(); 
        else showCustomAlert('Gagal', res.message);
      })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
      .adminBukaBlokirSiswa(stPengelola, id);
  });
}

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
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid var(--primary); padding-bottom:6px; margin-bottom:10px;">
            <b style="font-size:12px; color:var(--primary);">KARTU PESERTA CBT</b>
            <span style="font-size:11px; font-weight:700;">MAN 1 PALEMBANG</span>
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

function loadDataAdminGuruUjian() {
  const tb = document.getElementById('tblAdminGuruUjian'); tb.innerHTML = `<tr><td colspan="4" align="center">Memuat...</td></tr>`;
  cbtApi
    .withSuccessHandler(res => {
      if(!res.success || !res.data || res.data.length === 0) {
        tb.innerHTML = `<tr><td colspan="4" align="center">Belum ada penugasan guru mapel.</td></tr>`;
        window.cacheGuruList = res.guruList || [];
        window.cacheUjianList = res.ujianList || [];
        return;
      }
      window.cacheGuruList = res.guruList || [];
      window.cacheUjianList = res.ujianList || [];
      window.cacheGuruUjianData = res.data;
      
      tb.innerHTML = res.data.map(r => `
        <tr>
          <td><b>${r.nama_guru}</b></td>
          <td>${r.nama_ujian}</td>
          <td><span class="badge bg-gray">Tingkat ${r.tingkat}</span></td>
          <td style="display:flex; gap:6px;">
            <button class="btn btn-secondary" style="padding:4px 10px; font-size:11px;" onclick='editGuruUjian(${JSON.stringify(r)})'><i class="fa-solid fa-pen"></i> Edit</button>
            <button class="btn btn-danger" style="padding:4px 10px; font-size:11px;" onclick="hapusGuruUjian(${r.id})"><i class="fa-solid fa-trash"></i> Hapus</button>
          </td>
        </tr>
      `).join('');
    })
    .getAdminGuruUjianList(stPengelola);
}

function bukaModalGuruUjian() {
  document.getElementById('formGuruUjian').reset();
  document.getElementById('editGuruUjianId').value = '';
  document.getElementById('titleModalGuruUjian').textContent = 'Form Penugasan Guru Mapel';
  
  const selGuru = document.getElementById('inGuruId');
  const selUjian = document.getElementById('inUjianId');
  
  selGuru.innerHTML = (window.cacheGuruList || []).map(g => `<option value="${g.id}">${g.nama_lengkap || g.username}</option>`).join('');
  selUjian.innerHTML = (window.cacheUjianList || []).map(u => `<option value="${u.id}">${u.nama_mapel || 'Mapel'} — ${u.nama_ujian} (Sesi ${u.sesi || 1}) - Tingkat ${u.tingkat}</option>`).join('');
  
  document.getElementById('modalGuruUjian').classList.add('show');
}

function editGuruUjian(r) {
  document.getElementById('formGuruUjian').reset();
  document.getElementById('editGuruUjianId').value = r.id;
  document.getElementById('titleModalGuruUjian').textContent = 'Edit Penugasan Guru Mapel';
  
  const selGuru = document.getElementById('inGuruId');
  const selUjian = document.getElementById('inUjianId');
  
  selGuru.innerHTML = (window.cacheGuruList || []).map(g => `<option value="${g.id}">${g.nama_lengkap || g.username}</option>`).join('');
  selUjian.innerHTML = (window.cacheUjianList || []).map(u => `<option value="${u.id}">${u.nama_mapel || 'Mapel'} — ${u.nama_ujian} (Sesi ${u.sesi || 1}) - Tingkat ${u.tingkat}</option>`).join('');
  
  selGuru.value = r.guru_id;
  selUjian.value = r.ujian_id;
  
  document.getElementById('modalGuruUjian').classList.add('show');
}

document.getElementById('formGuruUjian').addEventListener('submit', function(e){
  e.preventDefault();
  const payload = {
    id: document.getElementById('editGuruUjianId').value || null,
    guru_id: document.getElementById('inGuruId').value,
    ujian_id: document.getElementById('inUjianId').value
  };
  showLoading('Menyimpan penugasan...');
  cbtApi
    .withSuccessHandler(res => { 
      hideLoading(); 
      if(res.success){ 
        document.getElementById('modalGuruUjian').classList.remove('show'); 
        loadDataAdminGuruUjian(); 
      } else {
        showCustomAlert('Gagal', res.message);
      }
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .simpanGuruUjianAdmin(stPengelola, payload);
});

function hapusGuruUjian(id) {
  showCustomConfirm("Hapus Penugasan", "Hapus penugasan guru ini?", () => {
    showLoading('Menghapus...');
    cbtApi
      .withSuccessHandler(res => { 
        hideLoading(); 
        if(res.success) loadDataAdminGuruUjian(); 
        else showCustomAlert('Gagal', res.message);
      })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
      .hapusGuruUjianAdmin(stPengelola, id);
  });
}

function loadDataAdminAkun() {
  const tb = document.getElementById('tblAdminAkun'); tb.innerHTML = `<tr><td colspan="6" align="center">Memuat...</td></tr>`;
  cbtApi
    .withSuccessHandler(rows => {
      if(!rows || rows.length===0) { tb.innerHTML=`<tr><td colspan="6" align="center">Tidak ada akun.</td></tr>`; return; }
      window.cacheAkunExcel = rows.map(a => [a.username, a.nama_lengkap, a.password, a.role, a.status_aktif]);
      tb.innerHTML = rows.map(a => `
        <tr>
          <td><b>${a.username}</b></td>
          <td>${a.nama_lengkap || '-'}</td>
          <td><code style="background:var(--secondary-bg); padding:2px 6px; border-radius:4px; font-weight:700;">${a.password || '-'}</code></td>
          <td><span class="badge bg-gray">${a.role.toUpperCase()}</span></td>
          <td><span class="badge ${a.status_aktif?'bg-green':'bg-red'}">${a.status_aktif?'AKTIF':'NONAKTIF'}</span></td>
          <td><button class="btn btn-secondary" style="padding:4px 10px; font-size:11px;" onclick='editAkun(${JSON.stringify(a)})'><i class="fa-solid fa-pen"></i> Edit</button></td>
        </tr>`).join('');
    })
    .getAdminAkunList(stPengelola);
}

function bukaModalAkun(data = null) {
  document.getElementById('formAkun').reset();
  if(data) {
    document.getElementById('titleModalAkun').textContent = "Edit Akun Pengelola";
    document.getElementById('editAkunId').value = data.id;
    document.getElementById('inAkunUsername').value = data.username;
    document.getElementById('inAkunNama').value = data.nama_lengkap || '';
    document.getElementById('inAkunPass').value = data.password || '';
    document.getElementById('inAkunRole').value = data.role;
    document.getElementById('inAkunStatus').value = String(data.status_aktif);
  } else {
    document.getElementById('titleModalAkun').textContent = "Tambah Akun Baru";
    document.getElementById('editAkunId').value = "";
  }
  document.getElementById('modalAkun').classList.add('show');
}
function editAkun(a) { bukaModalAkun(a); }

document.getElementById('formAkun').addEventListener('submit', function(e){
  e.preventDefault();
  const payload = {
    id: document.getElementById('editAkunId').value || null,
    username: document.getElementById('inAkunUsername').value,
    nama_lengkap: document.getElementById('inAkunNama').value,
    password: document.getElementById('inAkunPass').value,
    role: document.getElementById('inAkunRole').value,
    status_aktif: document.getElementById('inAkunStatus').value
  };
  showLoading('Menyimpan Akun...');
  cbtApi
    .withSuccessHandler(res => { 
      hideLoading(); 
      if(res.success){ 
        document.getElementById('modalAkun').classList.remove('show'); 
        loadDataAdminAkun(); 
      } else {
        showCustomAlert('Gagal', res.message);
      }
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .simpanAkunAdmin(stPengelola, payload);
});

function handleImportAkun(input) {
  handleExcelUpload(input, function(rows) {
    if (rows.length === 0) { showCustomAlert('Peringatan', 'File akun kosong.'); return; }
    showLoading('Mengimport akun...');
    cbtApi
      .withSuccessHandler(res => { hideLoading(); showCustomAlert('Informasi', res.message); loadDataAdminAkun(); input.value = ''; })
      .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); input.value = ''; })
      .importAkunBulk(stPengelola, rows);
  });
}

function bukaModalProfilGuru() {
  document.getElementById('formUbahPassGuru').reset();
  document.getElementById('alertUbahPass').className = 'alert';
  document.getElementById('modalUbahPassGuru').classList.add('show');
}

document.getElementById('formUbahPassGuru').addEventListener('submit', function(e) {
  e.preventDefault();
  const pLama = document.getElementById('inPassLama').value;
  const pBaru = document.getElementById('inPassBaru').value;
  const alertEl = document.getElementById('alertUbahPass');
  
  showLoading('Menyimpan password baru...');
  cbtApi
    .withSuccessHandler(res => {
      hideLoading();
      if(res.success) {
        alertEl.className = 'alert info';
        alertEl.textContent = res.message;
        setTimeout(() => document.getElementById('modalUbahPassGuru').classList.remove('show'), 1500);
      } else {
        alertEl.className = 'alert error';
        alertEl.textContent = res.message;
      }
    })
    .withFailureHandler(err => { hideLoading(); alertEl.className = 'alert error'; alertEl.textContent = 'Error: ' + err.message; })
    .updatePasswordGuru(stPengelola, pLama, pBaru);
});

function loadDataGuru() {
  const cont = document.getElementById('containerListUjianGuru');
  cont.innerHTML = `<div class="alert info">Mengambil data ujian & mapel yang diampu dari server...</div>`;
  cbtApi
    .withSuccessHandler(res => {
      if(!res || !res.success || !res.ujianList || res.ujianList.length===0){
        cont.innerHTML = `<div class="alert error" style="display:block;">Tidak ada ujian/mapel yang ditugaskan kepada Anda saat ini.</div>`; return;
      }
      
      const pelanggaranMap = {};
      (res.pelanggaranList || []).forEach(p => {
        if(!pelanggaranMap[p.ujian_id]) pelanggaranMap[p.ujian_id] = [];
        pelanggaranMap[p.ujian_id].push(p);
      });

      cont.innerHTML = res.ujianList.map(u => {
        const hasil = (res.hasilList||[]).filter(h => String(h.ujian_id) === String(u.id));
        const pelanggaranUjian = pelanggaranMap[u.id] || [];

        let tbHtml = hasil.length===0 ? `<tr><td colspan="5" align="center" style="color:var(--text-muted);">Belum ada peserta submit.</td></tr>` :
          hasil.map(h => `<tr><td>${h.nomor_ujian || '-'}</td><td><b>${h.nama_siswa || '-'}</b></td><td>${h.kelas || '-'}</td><td><b style="color:var(--primary); font-size:14px;">${h.nilai !== undefined ? h.nilai : 0}</b></td><td><span class="badge bg-green">${String(h.status || 'selesai').toUpperCase()}</span></td></tr>`).join('');
        
        let pelanggaranHtml = pelanggaranUjian.length === 0 ? `<p style="font-size:12px; color:var(--text-muted); padding:12px;">Tidak ada pelanggaran tercatat.</p>` : `
          <div class="table-responsive" style="margin-top:12px;">
            <table style="font-size:12px;">
              <thead><tr><th>No Peserta</th><th>Nama Siswa</th><th>Jumlah</th><th>Keterangan</th></tr></thead>
              <tbody>
                ${pelanggaranUjian.map(p => `<tr><td><b>${p.nomor_ujian || '-'}</b></td><td><b>${p.nama_siswa || '-'}</b></td><td><span class="badge bg-red">${p.jumlah_pelanggaran}x</span></td><td>${p.keterangan || '-'}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>`;

        let reportData = hasil.map(h => [h.nomor_ujian, h.nama_siswa, h.kelas, h.nilai, h.status]);
        
        return `
          <div class="card" style="border:1px solid var(--primary); padding:0; overflow:hidden; margin-bottom:20px;">
            <div style="background:#eff6ff; padding:16px 20px; border-bottom:1px solid #bfdbfe; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
              <div>
                <h3 style="font-size:16px; font-weight:800; color:var(--primary); margin-bottom:4px;"><i class="fa-solid fa-book-open"></i> ${u.nama_ujian}</h3>
                <p style="font-size:12px; color:var(--text-muted);">Tingkat: ${u.tingkat} | Sesi & Tanggal: ${u.nama_ujian} | Thn Ajaran: ${u.tahun_ajaran||'-'} (${u.semester||'-'}) | Submit: <b>${hasil.length} Siswa</b></p>
              </div>
              <div style="display:flex; gap:8px;">
                <button class="btn btn-secondary" style="padding:6px 12px; font-size:12px;" onclick='exportToExcel("laporan_${u.nama_ujian.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.xlsx", "Nilai", ["No Ujian", "Nama", "Kelas", "Nilai", "Status"], ${JSON.stringify(reportData)})'><i class="fa-solid fa-file-excel"></i> Download Excel</button>
              </div>
            </div>
            <div style="padding:16px;">
              <h4 style="font-size:13px; font-weight:700; margin-bottom:8px;">Daftar Nilai Siswa</h4>
              <div class="table-responsive">
                <table><thead><tr><th>No Peserta</th><th>Nama Siswa</th><th>Kelas</th><th>Nilai Akhir</th><th>Status</th></tr></thead><tbody>${tbHtml}</tbody></table>
              </div>
              <h4 style="font-size:13px; font-weight:700; margin:16px 0 8px 0;">Log Pelanggaran Siswa</h4>
              ${pelanggaranHtml}
            </div>
          </div>`;
      }).join('');
    })
    .withFailureHandler(err => {
      cont.innerHTML = `<div class="alert error" style="display:block;">Gagal memuat monitoring: ${err.message}</div>`;
    })
    .getGuruExamResults(stPengelola);
}

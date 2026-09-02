// Exam lifecycle: deterministic questions, answers, timer, anti-cheat, and submission.
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

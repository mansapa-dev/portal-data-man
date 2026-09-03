// Exam lifecycle: deterministic questions, answers, timer, anti-cheat, and submission.
let stTerminated = false;

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
  stTerminated = false;

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
    if(sisaS <= 0) { clearInterval(tmrUjian); tt.textContent = "00:00"; prosesKumpulFinal(); return; }
    if(sisaS <= 300) tb.classList.add('danger'); else tb.classList.remove('danger');
    tt.textContent = `${String(Math.floor(sisaS / 60)).padStart(2,'0')}:${String(sisaS % 60).padStart(2,'0')}`;
  }, 1000);
}

// ─── Anti-cheat & violation handling ────────────────────────────────────────

/**
 * Update progress dots merah sesuai jumlah pelanggaran (1, 2, atau 3).
 */
function updateViolationDots(jumlah) {
  const colors = { active: '#dc2626', inactive: '#e5e7eb' };
  const borders = { active: '#dc2626', inactive: '#d1d5db' };
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(`pdot${i}`);
    if (!dot) continue;
    const isActive = i <= jumlah;
    dot.style.background = isActive ? colors.active : colors.inactive;
    dot.style.borderColor = isActive ? borders.active : borders.borders;
    dot.style.transform = isActive ? 'scale(1.25)' : 'scale(1)';
  }
}

/**
 * Tampilkan modal pelanggaran.
 * @param {number} jumlah  — total pelanggaran saat ini (1-3)
 * @param {boolean} terminated — apakah sesi sudah dihentikan
 * @param {function|null} onDismiss — callback setelah modal ditutup (saat warning biasa)
 */
function showViolationModal(jumlah, terminated, onDismiss = null) {
  const modal = document.getElementById('modalPelanggaran');
  const title = document.getElementById('pelanggaranTitle');
  const icon = document.getElementById('pelanggaranIcon');
  const iconWrap = document.getElementById('pelanggaranIconWrap');
  const txt = document.getElementById('txtPelanggaran');
  const counter = document.getElementById('pelanggaranCounter');
  const btn = document.getElementById('btnPahamPelanggaran');
  const cdWrap = document.getElementById('pelanggaranCountdownWrap');
  const cdBar = document.getElementById('pelanggaranCountdownBar');
  const cdText = document.getElementById('pelanggaranCountdownText');

  updateViolationDots(jumlah);
  counter.textContent = `PELANGGARAN ${jumlah} / 3`;

  if (terminated) {
    // ── Terminate state ──
    title.textContent = 'Ujian Dihentikan!';
    title.style.color = '#dc2626';
    icon.className = 'fa-solid fa-ban';
    iconWrap.style.background = '#fecaca';
    iconWrap.style.border = '2px solid #dc2626';
    txt.textContent = 'Anda telah melakukan 3 kali pelanggaran. Ujian otomatis dihentikan dan nilai Anda telah dihitung oleh sistem.';
    btn.textContent = 'Memuat hasil...';
    btn.disabled = true;
    cdWrap.style.display = 'block';

    // Countdown 5 detik
    let sisa = 5;
    cdBar.style.width = '100%';
    cdText.textContent = `Halaman hasil akan tampil dalam ${sisa} detik...`;
    const cdTimer = setInterval(() => {
      sisa--;
      cdBar.style.width = `${(sisa / 5) * 100}%`;
      if (sisa <= 0) {
        clearInterval(cdTimer);
        cdText.textContent = 'Mengalihkan...';
      } else {
        cdText.textContent = `Halaman hasil akan tampil dalam ${sisa} detik...`;
      }
    }, 1000);
  } else {
    // ── Warning state ──
    const isLastWarn = jumlah === 2;
    title.textContent = isLastWarn ? 'Peringatan Terakhir!' : 'Peringatan Sistem!';
    title.style.color = isLastWarn ? '#b45309' : '#dc2626';
    icon.className = 'fa-solid fa-triangle-exclamation';
    iconWrap.style.background = isLastWarn ? '#fef3c7' : '#fee2e2';
    iconWrap.style.border = isLastWarn ? '2px solid #f59e0b' : 'none';
    txt.textContent = isLastWarn
      ? `Peringatan ${jumlah}/3: Anda terdeteksi keluar dari aplikasi CBT. Satu pelanggaran lagi akan menghentikan ujian Anda secara otomatis!`
      : `Peringatan ${jumlah}/3: Anda terdeteksi keluar dari aplikasi CBT. Harap tetap di halaman ini selama ujian berlangsung.`;
    btn.textContent = 'Saya Mengerti';
    btn.disabled = false;
    cdWrap.style.display = 'none';

    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', () => {
      modal.classList.remove('show');
      if (typeof onDismiss === 'function') onDismiss();
    });
  }

  modal.classList.add('show');
}

function aktifkanAntiCheat() {
  if (antiCheatAttached) return;
  antiCheatAttached = true;

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !isUjianJalan || isSubmitting) return;

    cbtApi
      .withSuccessHandler(res => {
        if (!res.success) return;

        if (res.dihentikan) {
          // ── TERMINATE ──
          isUjianJalan = false;
          clearInterval(tmrUjian);
          stTerminated = true;

          if (res.hasil) {
            // Server sudah hitung nilai → tampil modal terminate lalu switch ke hasil
            showViolationModal(res.jumlah, true);
            setTimeout(() => {
              document.getElementById('modalPelanggaran').classList.remove('show');
              tampilHasilUjian(res.hasil, true);
            }, 5500);
          } else {
            // Fallback: submit manual dulu
            showViolationModal(res.jumlah, true);
            submitUjianSilenKeServer(() => {
              setTimeout(() => {
                document.getElementById('modalPelanggaran').classList.remove('show');
                // hasil akan di-set oleh callback
              }, 5500);
            });
          }
        } else {
          // ── WARNING ──
          showViolationModal(res.jumlah, false);
        }
      })
      .withFailureHandler(() => {
        // Tetap tampil peringatan meski koneksi bermasalah
        showViolationModal(1, false);
      })
      .catatPelanggaranServer(stSiswa.id, stUjian.id);
  });
}

// ─── Submit helpers ───────────────────────────────────────────────────────────

/**
 * Tampilkan viewHasilSiswa dengan data hasil dari server.
 * @param {object} hasil  — { nilai, is_remedial, score_cap }
 * @param {boolean} isTerminate — apakah karena pelanggaran
 */
function tampilHasilUjian(hasil, isTerminate = false) {
  const lblNilai = document.getElementById('lblNilaiAkhir');
  const lblKet = document.getElementById('lblKeteranganHasil');
  const lblStatus = document.getElementById('lblStatusUjian');
  const badgeCap = document.getElementById('badgeRemedialCap');
  const btnReview = document.getElementById('btnReviewHasil');

  if (lblNilai) lblNilai.textContent = hasil.nilai !== undefined ? Number(hasil.nilai).toFixed(1) : '-';

  if (lblStatus) {
    lblStatus.textContent = isTerminate ? 'Ujian Dihentikan' : (hasil.is_remedial ? 'Ujian Ulang Selesai' : 'Ujian Selesai!');
    lblStatus.style.color = isTerminate ? '#dc2626' : 'var(--text-main)';
  }

  if (lblKet) {
    if (isTerminate) {
      lblKet.textContent = 'Ujian Anda dihentikan oleh sistem karena 3 kali pelanggaran terdeteksi. Nilai dihitung secara otomatis.';
      lblKet.style.color = '#dc2626';
    } else if (hasil.is_remedial && hasil.score_cap !== null) {
      lblKet.textContent = `Ini adalah ujian ulang (remedial). Nilai maksimum yang dapat diraih adalah ${hasil.score_cap}.`;
      lblKet.style.color = 'var(--text-muted)';
    } else {
      lblKet.textContent = 'Jawaban Anda telah berhasil dikirim dan tersimpan di server.';
      lblKet.style.color = 'var(--text-muted)';
    }
  }

  if (badgeCap) {
    if (hasil.is_remedial && hasil.score_cap !== null) {
      badgeCap.style.display = 'block';
      badgeCap.textContent = `NILAI UJIAN ULANG · CAP MAKS: ${hasil.score_cap}`;
    } else {
      badgeCap.style.display = 'none';
    }
  }

  // Sembunyikan tombol review jika terminate
  if (btnReview) btnReview.style.display = isTerminate ? 'none' : '';

  switchView('viewHasilSiswa');
}

function bukaModalSubmit() {
  let sisaKosong = stSoal.length - Object.keys(stJawab).length;
  document.getElementById('txtConfirmSubmit').innerHTML = sisaKosong > 0
    ? `Masih ada <strong style="color:var(--danger)">${sisaKosong} soal kosong</strong>. Kumpulkan?`
    : "Semua soal terjawab. Kumpulkan ujian?";
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
      if (res.success) {
        tampilHasilUjian(res.hasil, stTerminated);
      } else {
        showCustomAlert('Gagal Submit', res.message);
      }
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .submitUjian({ siswa_id: stSiswa.id, ujian_id: stUjian.id });
}

/**
 * Submit silen (tanpa UI loading utama) — digunakan saat terminate.
 */
function submitUjianSilenKeServer(onDone) {
  isSubmitting = true; isUjianJalan = false; clearInterval(tmrUjian);
  cbtApi
    .withSuccessHandler(res => {
      if (res.success && typeof onDone === 'function') {
        setTimeout(() => {
          document.getElementById('modalPelanggaran').classList.remove('show');
          tampilHasilUjian(res.hasil, true);
        }, 5500);
      }
    })
    .withFailureHandler(() => {
      setTimeout(() => {
        document.getElementById('modalPelanggaran').classList.remove('show');
        switchView('viewHasilSiswa');
      }, 5500);
    })
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
          st = jSiswa === kBenar
            ? '<span style="color:var(--success); font-weight:700;"><i class="fa-solid fa-check"></i> [BENAR]</span>'
            : '<span style="color:var(--danger); font-weight:700;"><i class="fa-solid fa-xmark"></i> [SALAH]</span>';
        }
        return `<div style="background:var(--secondary-bg); border:1px solid var(--border); border-radius:8px; padding:14px; font-size:12px;"><div style="display:flex; justify-content:space-between; margin-bottom:6px;"><b style="color:var(--primary);">Soal No. ${idx + 1}</b><div>${st}</div></div><div>${s.pertanyaan}</div></div>`;
      }).join('');
      document.getElementById('modalReview').classList.add('show');
    })
    .withFailureHandler(err => { hideLoading(); showCustomAlert('Error', err.message); })
    .getReviewUjianServer(stSiswa.id, stUjian.id);
}

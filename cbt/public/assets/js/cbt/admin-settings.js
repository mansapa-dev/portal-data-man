// admin-settings.js — Pengaturan Sistem CBT (nilai cap ujian ulang per tingkatan)
'use strict';

function loadDataAdminPengaturan() {
  const tabEl = document.getElementById('tabAdminPengaturan');
  if (!tabEl || tabEl.classList.contains('hidden')) return;

  cbtApi
    .withSuccessHandler(res => {
      if (!res.success || !res.data) return;
      const d = res.data;

      const grades = ['X', 'XI', 'XII'];
      grades.forEach(g => {
        const key = `remedial_score_cap_${g}`;
        const val = d[key] ? parseFloat(d[key].value) : 75;
        const slider = document.getElementById(`sliderCap${g}`);
        const input  = document.getElementById(`inputCap${g}`);
        if (slider) slider.value = val;
        if (input)  input.value  = val;
      });
    })
    .withFailureHandler(err => {
      // Jika settings belum ada (tabel belum di-migrate), gunakan default
      console.warn('Settings load failed:', err.message);
    })
    .getAdminSettings();
}

function simpanPengaturanSistem() {
  const grades = ['X', 'XI', 'XII'];
  const data = {};
  let valid = true;

  grades.forEach(g => {
    const input = document.getElementById(`inputCap${g}`);
    if (!input) return;
    const val = parseFloat(input.value);
    if (isNaN(val) || val < 0 || val > 100) {
      showCustomAlert('Input Tidak Valid', `Nilai cap untuk Tingkat ${g} harus antara 0 dan 100.`);
      valid = false;
      return;
    }
    data[`remedial_score_cap_${g}`] = val;
  });

  if (!valid) return;

  const btn = document.querySelector('#tabAdminPengaturan .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }

  cbtApi
    .withSuccessHandler(res => {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Pengaturan'; }
      if (res.success) {
        showToastInfo('✅ Pengaturan berhasil disimpan.');
      } else {
        showCustomAlert('Gagal', res.message);
      }
    })
    .withFailureHandler(err => {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Pengaturan'; }
      showCustomAlert('Error', err.message);
    })
    .saveAdminSettings(null, data);
}

// Toast helper (jika belum ada di core)
function showToastInfo(msg) {
  if (typeof showToast === 'function') { showToast(msg); return; }
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a2e;color:#fff;padding:12px 22px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.3);animation:fadeInUp .3s ease;';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

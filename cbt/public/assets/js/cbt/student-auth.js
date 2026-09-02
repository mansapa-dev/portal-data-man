// Student authentication and available exam list.
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

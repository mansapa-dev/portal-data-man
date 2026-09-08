// Student authentication and available exam list.
let cacheStudentJadwal = [];

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
  cacheStudentJadwal = jadwalArr || [];
  const container = document.getElementById('listJadwalUjian') || document.getElementById('listJadwalSiswa');
  if(!container) return;

  if(!jadwalArr || jadwalArr.length === 0) {
    container.innerHTML = '<div class="alert" style="margin:0;">Tidak ada jadwal ujian aktif untuk kelas/sesi Anda saat ini.</div>';
    return;
  }
  
  container.innerHTML = jadwalArr.map(j => {
    let btnHtml = '', cardClass = '';
    if (j.status_pengerjaan === 'selesai') {
      cardClass = 'style="opacity:0.6; background:var(--secondary-bg);"';
      btnHtml = `<button class="btn btn-secondary" style="padding:8px 16px; font-size:12px; width:auto;" disabled><i class="fa-solid fa-check"></i> Sudah Dikerjakan</button>`;
    } else if (j.status_pengerjaan === 'terblokir') {
      cardClass = 'style="border-color:var(--danger); background:#fef2f2;"';
      btnHtml = `<button class="btn btn-danger" style="padding:8px 16px; font-size:12px; width:auto;" onclick="openSupportTicket('EXAM_LOCKED', ${j.id})"><i class="fa-solid fa-headset"></i> Minta Bantuan Petugas</button>`;
    } else if (j.status_pengerjaan === 'berlangsung' && j.can_start) {
      btnHtml = `<button class="btn btn-success" style="padding:8px 16px; font-size:12px; width:auto;" onclick="persiapkanUjianById(${j.id})"><i class="fa-solid fa-play"></i> Lanjutkan</button>`;
    } else if (!j.can_start) {
      const inactiveLabels = { NOT_SCHEDULED:'Tidak Dijadwalkan', UPCOMING:'Belum Dimulai', ENDED:'Jadwal Berakhir', INACTIVE:'Tidak Aktif', NOT_ELIGIBLE:'Tidak Tersedia', EXPIRED:'Waktu Habis' };
      cardClass = 'style="opacity:.72; background:var(--secondary-bg);"';
      btnHtml = `<button class="btn btn-secondary" style="padding:8px 16px; font-size:12px; width:auto;" disabled><i class="fa-solid fa-lock"></i> ${inactiveLabels[j.availability_reason] || 'Tidak Tersedia'}</button>`;
    } else {
      btnHtml = `<button class="btn btn-success" style="padding:8px 16px; font-size:12px; width:auto;" onclick="persiapkanUjianById(${j.id})"><i class="fa-solid fa-play"></i> Mulai Ujian</button>`;
    }
    return `
      <div class="card" ${cardClass} style="display:flex; justify-content:space-between; align-items:center; padding:16px; margin:0;">
        <div>
          <h4 style="font-size:14px; font-weight:800; color:var(--text-main); margin-bottom:4px;">${j.nama_ujian} ${j.is_special ? `<span class="badge bg-blue" style="margin-left:6px;">${j.special_type === 'REMEDIAL' ? 'Ujian Ulang' : 'Susulan'}</span>` : ''}</h4>
          <p style="font-size:11px; color:var(--text-muted);"><i class="fa-regular fa-calendar-days"></i> Tanggal: <b>${j.tanggal_ujian || 'TBD'}</b> | Sesi ${j.sesi} | Durasi: ${j.durasi_menit}m</p>
        </div>
        <div>${btnHtml}</div>
      </div>
    `;
  }).join('');
}

function persiapkanUjianById(id) {
  const j = (cacheStudentJadwal || []).find(x => String(x.id) === String(id));
  if (j?.can_start && !['selesai', 'terblokir'].includes(j.status_pengerjaan)) persiapkanUjian(j);
}

// Refresh only while the student is looking at the dashboard; jitter spreads load.
(function refreshStudentDashboard() {
  setTimeout(() => {
    const view = document.getElementById('viewPortalSiswa');
    if (!stSiswa || document.hidden || !view || view.classList.contains('hidden') || isUjianJalan) {
      refreshStudentDashboard(); return;
    }
    cbtApi.withSuccessHandler(result => { renderDaftarJadwal(result.jadwal); refreshStudentDashboard(); })
      .withFailureHandler(() => refreshStudentDashboard()).getStudentExamsAPI();
  }, 15000 + Math.random() * 10000);
})();

function kembaliKeDashboardSiswa() {
  showLoading('Memuat dashboard ujian...');
  cbtApi.withSuccessHandler(result => {
    hideLoading(); renderDaftarJadwal(result.jadwal); switchView('viewPortalSiswa');
  }).withFailureHandler(error => {
    hideLoading(); showCustomAlert('Dashboard Belum Tersedia', error.message, 'error');
  }).getStudentExamsAPI();
}

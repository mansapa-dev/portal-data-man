// Student authentication and available exam list.
let cacheStudentJadwal = [];

document.getElementById('formLoginSiswa').addEventListener('submit', function(e) {
  e.preventDefault();
  const normalizeStudentDigits = value => String(value || '').normalize('NFKC')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[\s\u00a0\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]+/g, '');
  const noField = document.getElementById('inNoUjian');
  const pinField = document.getElementById('inPin');
  const no = normalizeStudentDigits(noField.value);
  const pin = normalizeStudentDigits(pinField.value);
  noField.value = no; pinField.value = pin;
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
      alert.className = 'alert error';
      alert.textContent = Number(err.status) >= 400 && Number(err.status) < 500
        ? err.message
        : 'Gagal terhubung ke server: ' + err.message;
    })
    .loginSiswaAPI(no, pin);
});

function renderDaftarJadwal(jadwalArr) {
  cacheStudentJadwal = jadwalArr || [];
  const container = document.getElementById('listJadwalUjian') || document.getElementById('listJadwalSiswa');
  if(!container) return;

  renderStudentExamCards(cacheStudentJadwal);
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
  }, 25000 + Math.random() * 15000);
})();

function kembaliKeDashboardSiswa() {
  showLoading('Memuat dashboard ujian...');
  cbtApi.withSuccessHandler(result => {
    hideLoading(); renderDaftarJadwal(result.jadwal); switchView('viewPortalSiswa');
  }).withFailureHandler(error => {
    hideLoading(); showCustomAlert('Dashboard Belum Tersedia', error.message, 'error');
  }).getStudentExamsAPI();
}

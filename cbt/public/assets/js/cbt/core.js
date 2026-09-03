// Shared state, loading feedback, dialogs, view switching, and table filtering.
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

function showLoading(msg = 'Memuat...') {
  document.getElementById('loaderText').textContent = msg;
  document.getElementById('loaderGlobal').classList.add('show');
}
function hideLoading() {
  document.getElementById('loaderGlobal').classList.remove('show');
}

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
    if (typeof onYes === 'function') onYes();
  });
  newBtnBatal.addEventListener('click', () => {
    modal.classList.remove('show');
  });
}

function switchView(viewId) {
  ['viewLoginSiswa', 'viewPortalSiswa', 'viewRuangUjian', 'viewHasilSiswa', 'viewDashboardPengelola'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(viewId);
  if (target) target.classList.remove('hidden');
}

function updateTopbarAuthUI(isLoggedIn) {
  const btnTopLogout = document.getElementById('btnTopLogoutPengelola');
  const btnIconLock = document.getElementById('btnIconLockPengelola');
  const btnMobileToggle = document.getElementById('btnMobileSidebarToggle');
  const breadcrumbs = document.getElementById('topbarBreadcrumbs');

  if (isLoggedIn) {
    if (btnTopLogout) {
      btnTopLogout.classList.remove('hidden');
      btnTopLogout.style.display = 'inline-flex';
    }
    if (btnIconLock) {
      btnIconLock.classList.add('hidden');
      btnIconLock.style.display = 'none';
    }
    if (btnMobileToggle) {
      btnMobileToggle.classList.remove('hidden');
      btnMobileToggle.style.display = 'inline-flex';
    }
    if (breadcrumbs) breadcrumbs.classList.remove('hidden');
  } else {
    if (btnTopLogout) {
      btnTopLogout.classList.add('hidden');
      btnTopLogout.style.display = 'none';
    }
    if (btnIconLock) {
      btnIconLock.classList.remove('hidden');
      btnIconLock.style.display = 'inline-flex';
    }
    if (btnMobileToggle) {
      btnMobileToggle.classList.add('hidden');
      btnMobileToggle.style.display = 'none';
    }
    if (breadcrumbs) breadcrumbs.classList.add('hidden');
  }
}

function toggleMobileSidebar() {
  const sb = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sb) sb.classList.toggle('open');
  if (backdrop) backdrop.classList.toggle('hidden');
}

function closeMobileSidebar() {
  const sb = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sb) sb.classList.remove('open');
  if (backdrop) backdrop.classList.add('hidden');
}

async function appResetLogout() {
  // 1. Seketika ubah tampilan UI ke halaman depan login siswa dan ubah tombol logout kembali menjadi gembok
  updateTopbarAuthUI(false);
  stSiswa = { id: null, nama: '', kelas: '', no: '' };
  stUjian = { id: null, nama: '', durasi: 0 };
  stSoal = [];
  stJawab = {};
  stRagu = {};
  stIdx = 0;
  isUjianJalan = false;
  isSubmitting = false;
  if (tmrUjian) clearInterval(tmrUjian);
  stPengelola = { userId: null, id: null, role: null, nama: '', username: '' };

  document.querySelectorAll('.modal').forEach((m) => m.classList.remove('show'));
  const fSiswa = document.getElementById('formLoginSiswa');
  if (fSiswa) fSiswa.reset();
  const fPengelola = document.getElementById('formLoginPengelola');
  if (fPengelola) fPengelola.reset();
  const aSiswa = document.getElementById('alertLoginSiswa');
  if (aSiswa) aSiswa.className = 'alert';
  const aPengelola = document.getElementById('alertLoginPengelola');
  if (aPengelola) aPengelola.className = 'alert';

  // Tampilkan halaman depan login siswa secara instan
  switchView('viewLoginSiswa');
  hideLoading();

  // 2. Bersihkan sesi di server secara realtime di latar belakang
  try {
    if (typeof window.cbtServerLogout === 'function') {
      await window.cbtServerLogout();
    } else {
      await fetch('api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    }
  } catch (_) {
    // Sesi lokal telah dibersihkan
  }
}

function filterTable(tableId, query) {
  const q = query.toLowerCase();
  const trs = document.querySelectorAll(`#${tableId} tr`);
  trs.forEach((tr) => {
    const text = tr.textContent.toLowerCase();
    tr.style.display = text.includes(q) ? '' : 'none';
  });
}

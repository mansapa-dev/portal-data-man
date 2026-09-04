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

function showCustomAlert(title, message, type = 'auto') {
  const elTitle = document.getElementById('alertTitle');
  const elMessage = document.getElementById('alertMessage');
  const elIcon = document.getElementById('alertIcon');
  const elContainer = document.getElementById('alertIconContainer');
  const elCategory = document.getElementById('alertBadgeCategory');

  if (elTitle) elTitle.textContent = title;
  if (elMessage) elMessage.textContent = message;

  const tLow = String(title || '').toLowerCase();
  const mLow = String(message || '').toLowerCase();

  let resolvedType = type;
  if (resolvedType === 'auto') {
    if (tLow.includes('sukses') || tLow.includes('berhasil') || mLow.includes('berhasil')) {
      resolvedType = 'success';
    } else if (tLow.includes('gagal') || tLow.includes('error') || tLow.includes('kesalahan') || mLow.includes('gagal') || mLow.includes('error')) {
      resolvedType = 'error';
    } else if (tLow.includes('peringatan') || tLow.includes('perhatian')) {
      resolvedType = 'warning';
    } else {
      resolvedType = 'info';
    }
  }

  if (elContainer && elIcon) {
    if (resolvedType === 'success') {
      elContainer.style.background = '#ecfdf5';
      elContainer.style.color = '#10b981';
      elIcon.className = 'fa-solid fa-circle-check';
      if (elCategory) { elCategory.textContent = 'BERHASIL'; elCategory.style.color = '#10b981'; }
    } else if (resolvedType === 'error') {
      elContainer.style.background = '#fef2f2';
      elContainer.style.color = '#ef4444';
      elIcon.className = 'fa-solid fa-circle-xmark';
      if (elCategory) { elCategory.textContent = 'TERJADI KESALAHAN'; elCategory.style.color = '#ef4444'; }
    } else if (resolvedType === 'warning') {
      elContainer.style.background = '#fffbeb';
      elContainer.style.color = '#f59e0b';
      elIcon.className = 'fa-solid fa-triangle-exclamation';
      if (elCategory) { elCategory.textContent = 'PERINGATAN'; elCategory.style.color = '#f59e0b'; }
    } else {
      elContainer.style.background = '#eff6ff';
      elContainer.style.color = '#3b82f6';
      elIcon.className = 'fa-solid fa-circle-info';
      if (elCategory) { elCategory.textContent = 'INFORMASI'; elCategory.style.color = '#3b82f6'; }
    }
  }

  const modal = document.getElementById('modalCustomAlert');
  if (modal) modal.classList.add('show');
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

function toggleSidebarMenu() {
  const sb = document.querySelector('.sidebar') || document.getElementById('mainSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const btn = document.getElementById('btnMobileSidebarToggle');
  const isMobile = window.innerWidth <= 900;

  if (!sb) return;

  if (isMobile) {
    const willOpen = !sb.classList.contains('open');
    if (willOpen) {
      sb.classList.add('open');
      if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.style.display = 'block';
      }
      if (btn) btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    } else {
      sb.classList.remove('open');
      if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.style.display = 'none';
      }
      if (btn) btn.innerHTML = '<i class="fa-solid fa-bars"></i>';
    }
  } else {
    // Desktop: pertahankan sidebar mini agar menu utama tetap mudah dijangkau.
    const isCollapsed = sb.classList.toggle('collapsed');
    sb.querySelectorAll('.sb-item').forEach(item => {
      const label = item.querySelector('.sb-label')?.textContent?.trim();
      if (label) item.title = isCollapsed ? label : '';
    });
    try { localStorage.setItem('cbt_admin_sidebar_collapsed', isCollapsed ? '1' : '0'); } catch (_) {}
    if (btn) {
      btn.innerHTML = isCollapsed ? '<i class="fa-solid fa-bars"></i>' : '<i class="fa-solid fa-bars-staggered"></i>';
      btn.title = isCollapsed ? 'Perluas Menu Sidebar' : 'Ciutkan Menu Sidebar';
      btn.setAttribute('aria-expanded', String(!isCollapsed));
    }
  }
}

function toggleMobileSidebar() {
  toggleSidebarMenu();
}

function closeMobileSidebar() {
  const sb = document.querySelector('.sidebar') || document.getElementById('mainSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const btn = document.getElementById('btnMobileSidebarToggle');
  if (sb) {
    sb.classList.remove('open');
    if (window.innerWidth > 900) {
      sb.classList.add('collapsed');
    }
  }
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.style.display = 'none';
  }
  if (btn) btn.innerHTML = '<i class="fa-solid fa-bars"></i>';
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

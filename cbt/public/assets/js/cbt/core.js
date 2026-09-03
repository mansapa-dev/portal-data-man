
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

async function appResetLogout() {
  try {
    showLoading('Keluar dari sistem...');
    if (typeof window.cbtServerLogout === 'function') {
      await window.cbtServerLogout();
    } else {
      await fetch('api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    }
  } catch (_) {
    // abaikan jika terjadi kendala jaringan
  } finally {
    stSiswa = { id: null }; stUjian = { id: null }; stSoal = []; stJawab = {}; stRagu = {}; stIdx = 0;
    isUjianJalan = false; isSubmitting = false; clearInterval(tmrUjian);
    stPengelola = { userId: null, id: null, role: null, nama: '', username: '' };
    
    // Realtime auto-refresh ke halaman awal
    window.location.replace(window.location.pathname);
  }
}

function filterTable(tableId, query) {
  const q = query.toLowerCase();
  const trs = document.querySelectorAll(`#${tableId} tr`);
  trs.forEach(tr => {
    const text = tr.textContent.toLowerCase();
    tr.style.display = text.includes(q) ? '' : 'none';
  });
}

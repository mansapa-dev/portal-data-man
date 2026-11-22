/**
 * Mode ujian: menahan siswa di layar ujian.
 *
 * Lapisan web hanya bisa melakukan yang diizinkan browser:
 * - fullscreen (desktop/Android; iPhone Safari membatasi fullscreen elemen),
 * - menjebak tombol Back lewat history API,
 * - memunculkan konfirmasi sebelum refresh/tutup tab (beforeunload),
 * - memblokir shortcut navigasi (F5, Ctrl/Cmd+R, Alt+←/→),
 * - meminta shell Android masuk mode kiosk lewat bridge ArenaApp.setExamMode.
 *
 * Blokir total tombol Home/Recents di Android butuh screen pinning / Lock Task
 * (dilakukan shell native). Di iPhone, blokir penuh hanya bisa lewat Guided
 * Access yang diaktifkan pengawas; web tetap mencatat upaya keluar sebagai
 * pelanggaran.
 */

type ArenaHostWindow = Window & {
  ArenaApp?: {
    setExamMode?: (enabled: boolean) => void;
    setKeepScreenOn?: (enabled: boolean) => void;
  };
};

let examModeActive = false;
let historyTrapped = false;

const trapPopState = () => {
  if (!examModeActive) return;
  try {
    window.history.pushState({ arenaExamLock: true }, '', window.location.href);
  } catch {
    /* history tidak tersedia; lapisan native tetap menjaga */
  }
};

const promptBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!examModeActive) return;
  event.preventDefault();
  event.returnValue = '';
};

const blockNavigationKeys = (event: KeyboardEvent) => {
  if (!examModeActive || event.repeat) return;
  const key = event.key.toLowerCase();
  const altNavigation = event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
  const refresh = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && key === 'r');
  const browserChrome = (event.ctrlKey || event.metaKey) && ['l', 't', 'n', 'w'].includes(key);
  if (altNavigation || refresh || browserChrome) {
    event.preventDefault();
    event.stopPropagation();
  }
};

const requestFullscreen = () => {
  const root = document.documentElement;
  if (document.fullscreenElement || typeof root.requestFullscreen !== 'function') return;
  void root.requestFullscreen().catch(() => {
    /* Butuh gesture pengguna atau tidak didukung (mis. iPhone Safari). */
  });
};

// Browser mewajibkan gesture pengguna untuk fullscreen. Saat mode ujian aktif,
// ketukan/penekanan tombol pertama dipakai untuk masuk fullscreen otomatis.
// Listener sengaja TIDAK dilepas sampai fullscreen benar-benar aktif: sebagian
// WebView Android menolak permintaan pertama, dan tanpa ini siswa kehilangan
// kesempatan berikutnya tanpa mengetuk ulang layar.
const firstGestureFullscreen = () => {
  if (!examModeActive) return;
  const root = document.documentElement;
  const detach = () => {
    window.removeEventListener('pointerdown', firstGestureFullscreen, true);
    window.removeEventListener('keydown', firstGestureFullscreen, true);
  };
  if (document.fullscreenElement || typeof root.requestFullscreen !== 'function') {
    detach();
    return;
  }
  void root.requestFullscreen().then(() => {
    if (document.fullscreenElement) detach();
  }).catch(() => {
    /* coba lagi pada gesture berikutnya */
  });
};

// Banyak HP Android (Xiaomi/Realme/Oppo/Samsung) melepas fullscreen saat aplikasi
// di-background, ditarik dari Recents, atau saat notifikasi menutupi layar.
// Begitu mode ujian masih aktif, pasang lagi pemicu gesture supaya siswa cukup
// menyentuh layar sekali untuk kembali terkunci, tanpa perlu keluar ujian.
const rearmFullscreenGesture = () => {
  if (!examModeActive || document.fullscreenElement) return;
  window.removeEventListener('pointerdown', firstGestureFullscreen, true);
  window.removeEventListener('keydown', firstGestureFullscreen, true);
  window.addEventListener('pointerdown', firstGestureFullscreen, true);
  window.addEventListener('keydown', firstGestureFullscreen, true);
};

const onFullscreenChange = () => {
  if (!examModeActive) return;
  rearmFullscreenGesture();
};

const onVisibilityForFullscreen = () => {
  if (document.hidden) return;
  // Kembali dari background: coba langsung (sebagian WebView mengizinkannya),
  // lalu siapkan gesture sebagai fallback.
  requestFullscreen();
  rearmFullscreenGesture();
};

export function setExamMode(enabled: boolean): void {
  const host = window as ArenaHostWindow;
  // Penanda untuk shell Android: shell juga memeriksa atribut ini sendiri,
  // sehingga kunci layar tidak bergantung pada satu panggilan bridge saja.
  // Nilai 'off' penting agar shell tidak mengunci ulang saat siswa membuka
  // dialog bantuan atau saat jawaban gagal disimpan.
  try {
    document.documentElement.setAttribute('data-arena-exam', enabled ? 'on' : 'off');
  } catch {
    /* dokumen belum siap */
  }
  try {
    host.ArenaApp?.setExamMode?.(enabled);
  } catch {
    /* shell lama tanpa bridge mode ujian */
  }
  if (enabled === examModeActive) {
    if (enabled) requestFullscreen();
    return;
  }
  examModeActive = enabled;
  if (enabled) {
    if (!historyTrapped) {
      try {
        window.history.pushState({ arenaExamLock: true }, '', window.location.href);
        historyTrapped = true;
      } catch {
        /* abaikan */
      }
    }
    window.addEventListener('popstate', trapPopState);
    window.addEventListener('beforeunload', promptBeforeUnload);
    window.addEventListener('pointerdown', firstGestureFullscreen, true);
    window.addEventListener('keydown', firstGestureFullscreen, true);
    document.addEventListener('keydown', blockNavigationKeys, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', onVisibilityForFullscreen);
    requestFullscreen();
  } else {
    window.removeEventListener('popstate', trapPopState);
    window.removeEventListener('beforeunload', promptBeforeUnload);
    window.removeEventListener('pointerdown', firstGestureFullscreen, true);
    window.removeEventListener('keydown', firstGestureFullscreen, true);
    document.removeEventListener('keydown', blockNavigationKeys, true);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('visibilitychange', onVisibilityForFullscreen);
    historyTrapped = false;
    try {
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    } catch {
      /* fullscreen sudah dilepas */
    }
  }
}

export function isExamModeActive(): boolean {
  return examModeActive;
}

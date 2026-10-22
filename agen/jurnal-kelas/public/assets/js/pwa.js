// PWA Service Worker Registration & Easy Install Prompt for Teachers
(function () {
  'use strict';

  // 1. Daftarkan Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (installing) {
              installing.addEventListener('statechange', () => {
                if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                  // Konten baru tersedia, refresh halus di background
                  console.log('Versi baru Jurnal Kelas tersedia.');
                }
              });
            }
          });
        })
        .catch((error) => {
          console.warn('PWA Service Worker registration skipped:', error);
        });
    });
  }

  // 2. Banner Pasang Aplikasi yang Ramah untuk Guru Awam
  let deferredPrompt = null;
  const STORAGE_KEY = 'jurnal_pwa_dismissed';

  window.addEventListener('beforeinstallprompt', (event) => {
    // Cegah mini-infobar default browser agar bisa menampilkan banner yang jelas
    event.preventDefault();
    deferredPrompt = event;

    // Cek apakah baru saja ditutup oleh user
    const dismissedAt = localStorage.getItem(STORAGE_KEY);
    if (dismissedAt && Date.now() - Number(dismissedAt) < 7 * 24 * 60 * 60 * 1000) {
      return;
    }

    renderInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.remove();
    console.log('Jurnal Kelas PWA berhasil dipasang!');
  });

  function renderInstallBanner() {
    if (document.getElementById('pwa-install-banner')) return;

    const banner = document.createElement('aside');
    banner.id = 'pwa-install-banner';
    banner.setAttribute('aria-label', 'Pasang Aplikasi Jurnal');
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
        <img src="/assets/img/icon-192.png" alt="Logo" style="width:40px;height:40px;border-radius:10px;object-fit:cover;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,0.15);" />
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
          <strong style="font-size:13px;font-weight:750;color:#1e293b;line-height:1.2;">Pasang Aplikasi Jurnal di HP</strong>
          <span style="font-size:11px;color:#64748b;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Lebih cepat dibuka &amp; tidak perlu ketik link lagi</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <button id="pwa-install-btn" type="button" style="display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:6px 14px;border:none;border-radius:8px;background:#006527;color:#ffffff;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 2px 6px rgba(0,101,39,0.25);">
          Pasang
        </button>
        <button id="pwa-dismiss-btn" type="button" aria-label="Tutup" style="display:grid;place-items:center;width:32px;height:32px;border:none;border-radius:50%;background:rgba(0,0,0,0.05);color:#64748b;font-size:16px;cursor:pointer;">
          &times;
        </button>
      </div>
    `;

    Object.assign(banner.style, {
      position: 'fixed',
      bottom: '16px',
      left: '16px',
      right: '16px',
      maxWidth: '460px',
      margin: '0 auto',
      zIndex: '9999',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '12px 14px',
      borderRadius: '16px',
      backgroundColor: '#ffffff',
      border: '1px solid #e2e8f0',
      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      transition: 'transform 0.25s ease, opacity 0.25s ease'
    });

    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        banner.remove();
      }
      deferredPrompt = null;
    });

    document.getElementById('pwa-dismiss-btn')?.addEventListener('click', () => {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(20px)';
      setTimeout(() => banner.remove(), 250);
    });
  }
})();

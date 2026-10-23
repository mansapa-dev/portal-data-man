const CACHE_NAME = 'agen-jurnal-v2';
const STATIC_ASSETS = [
  '/',
  '/assets/css/app.css',
  '/assets/css/attendance.css',
  '/assets/css/journals.css',
  '/assets/css/dashboard-design.css',
  '/assets/img/icon-192.png',
  '/assets/img/icon-512.png',
  '/assets/img/logo-man1-palembang.png',
  '/manifest.json'
];

// Install Event: cache static shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: clear out older versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Jangan cache request non-GET atau request autentikasi / OIDC / API mutating
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/auth/sso') || url.pathname.startsWith('/logout')) return;

  // Static Assets (CSS, JS, Fonts, Images) -> Cache-first with network fallback
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigations (Halaman HTML) -> Network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            // Fallback ke dashboard jika offline
            return caches.match('/dashboard').then((dash) => dash || caches.match('/'));
          });
        })
    );
  }
});

# Deployment Shared Hosting cPanel

Target domain production: `https://agen.rdmman1plg.id`

1. Di lokal jalankan `composer install --no-dev --optimize-autoloader`.
2. Salin `.env.example` menjadi `.env`, isi credential melalui kanal aman, dan pastikan `APP_DEBUG=false`.
3. Upload seluruh proyek di luar `public_html` bila hosting memungkinkan.
4. Buat subdomain `agen.rdmman1plg.id` dan arahkan document root ke `jurnal-kelas/public` (contoh: `/home/CPANEL_USER/apps/jurnal-kelas/public`).
5. Jalankan `php database/migrate.php`, lalu `php database/seed.php` sekali.
6. Pastikan `storage/logs`, `storage/tmp`, `storage/cache`, dan `storage/app/private` writable oleh PHP tetapi tidak public.
7. Pasang SSL pada subdomain, paksa redirect HTTP→HTTPS, lalu set `SESSION_SECURE=true`.
8. Pastikan ekstensi `pdo_mysql`, `mbstring`, `openssl`, `fileinfo`, `json`, `gd`, `zip`, dan bila tersedia `intl` aktif.
9. Jangan menaruh `.env`, source, log, atau upload private di document root.
10. Cron opsional nantinya membersihkan session kedaluwarsa, cache Portal Data, dan temporary export.

## Konfigurasi SSO Portal Data

Daftarkan aplikasi `jurnal-kelas` di Portal Data dengan redirect URI `https://agen.rdmman1plg.id/auth/sso/callback` dan post-logout URI `https://agen.rdmman1plg.id/login`. Isi `.env` agen dengan issuer, base URL API, `OIDC_CLIENT_ID`, dan `OIDC_CLIENT_SECRET` dari aplikasi tersebut. Minta scope `openid profile email portal_data.read`.

Setelah migrasi, jalankan seed untuk memasukkan mata pelajaran TA 2026/2027:

```bash
php database/seed.php
```

Jika cPanel tidak dapat mengubah document root, letakkan isi `public/` di `public_html` dan ubah path bootstrap secara eksplisit ke folder aplikasi di luar `public_html`; jangan menyalin source aplikasi ke area publik.

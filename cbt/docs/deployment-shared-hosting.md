# Deployment CBT + Portal Data ke Shared Hosting/cPanel

Dokumen ini merupakan runbook production untuk:

- Portal Data Laravel: `https://sipadu.example.sch.id`
- CBT PHP Native: `https://cbt.example.sch.id`

Ganti seluruh contoh domain, `CPANEL_USER`, nama database, dan path sesuai akun hosting. Jangan memasukkan password atau API key ke Git, screenshot, tiket support, maupun URL.

## 1. Arsitektur production

```text
Browser siswa/guru/admin
        |
        +--> cbt.example.sch.id -> /home/CPANEL_USER/apps/cbt-man1/public
        |                              |
        |                              +--> MySQL database CBT
        |                              +--> HTTPS backend request + API key
        |
        +--> sipadu.example.sch.id -> /home/CPANEL_USER/apps/portal-data/laravel/public
                                           |
                                           +--> MySQL database Portal Data
```

Gunakan dua database dan dua user database yang berbeda. CBT tidak boleh melakukan `SELECT` langsung ke database Portal Data.

## 2. Kebutuhan hosting

- Apache dengan `mod_rewrite` dan dukungan `.htaccess`.
- PHP 8.2 atau 8.3 untuk kedua subdomain.
- MySQL 8 atau MariaDB 10.6+ dengan InnoDB.
- PHP extensions: `ctype`, `curl`, `dom`, `fileinfo`, `filter`, `hash`, `intl`, `json`, `mbstring`, `openssl`, `pdo_mysql`, `session`, `simplexml`, `tokenizer`, `xml`, `xmlreader`, `xmlwriter`, dan `zip`.
- Composer 2 dapat dijalankan di server atau lokal dengan versi PHP yang sama.
- Node.js hanya untuk build Portal Data di komputer lokal. Production tidak menjalankan Node server.
- SSL valid untuk kedua subdomain.

CBT tidak membutuhkan Docker, Redis, Supervisor, WebSocket, queue worker, atau akses root. Portal Data memakai `QUEUE_CONNECTION=sync` dan `CACHE_STORE=file`.

## 3. Struktur folder aman

```text
/home/CPANEL_USER/
|-- apps/
|   |-- portal-data/laravel/
|   |   |-- app, bootstrap, config, database, resources, routes, storage, vendor
|   |   |-- public/                 <- document root sipadu
|   |   `-- .env                    <- permission 600
|   `-- cbt-man1/
|       |-- app, database, resources, storage, vendor
|       |-- public/                 <- document root cbt
|       `-- .env                    <- permission 600
`-- backups/                        <- tidak berada di web root
```

Jangan arahkan document root ke root repository. File `.env`, schema, log, source PHP, dan backup SQL tidak boleh dapat diakses melalui HTTP.

## 4. Persiapan release di komputer lokal

### Portal Data

```bash
cd portal-data-man/laravel
composer install --no-dev --prefer-dist --optimize-autoloader
npm ci
npm run build
php artisan test
```

Upload `vendor/` bila Composer tidak tersedia di cPanel. Upload `public/build/` hasil Vite dari commit yang sama. Jangan upload `node_modules/` atau `.env` lokal.

### CBT

```bash
cd cbt
composer install --no-dev --prefer-dist --optimize-autoloader
composer test
composer lint
```

Upload folder `vendor/`, tetapi jangan upload `.env` lokal, log lokal, atau file import sementara.

## 5. Buat subdomain dan database di cPanel

1. Buat subdomain `sipadu.example.sch.id` dengan document root `/home/CPANEL_USER/apps/portal-data/laravel/public`.
2. Buat subdomain `cbt.example.sch.id` dengan document root `/home/CPANEL_USER/apps/cbt-man1/public`.
3. Buat database `CPANEL_USER_portal_data` dan user khusus Portal Data.
4. Buat database `CPANEL_USER_cbt` dan user khusus CBT.
5. Berikan masing-masing user privilege hanya pada database miliknya.
6. Aktifkan SSL/AutoSSL, lalu paksa HTTPS.

## 6. Generate secret

Generate nilai berbeda untuk `APP_KEY`, setup token, dan API key. Contoh melalui PHP lokal:

```bash
php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
```

Gunakan satu nilai acak yang sama hanya untuk pasangan berikut:

```text
Portal Data CBT_INTEGRATION_API_KEY
                =
CBT PORTAL_DATA_API_KEY
```

Jangan menggunakan password database sebagai integration key.

## 7. Environment Portal Data

Buat `/home/CPANEL_USER/apps/portal-data/laravel/.env`:

```env
APP_NAME="Portal Data MAN 1 Palembang"
APP_ENV=production
APP_DEBUG=false
APP_URL=https://sipadu.example.sch.id
APP_KEY=base64:HASIL_ARTISAN_KEY_GENERATE

DB_CONNECTION=mysql
DB_HOST=localhost
DB_PORT=3306
DB_DATABASE=CPANEL_USER_portal_data
DB_USERNAME=CPANEL_USER_portal_user
DB_PASSWORD=PASSWORD_DATABASE_PORTAL

SESSION_DRIVER=file
SESSION_LIFETIME=480
SESSION_ENCRYPT=true
SESSION_PATH=/
SESSION_DOMAIN=null
SESSION_SECURE_COOKIE=true
SESSION_SAME_SITE=lax

CACHE_STORE=file
QUEUE_CONNECTION=sync
FILESYSTEM_DISK=local

OIDC_ISSUER=https://sipadu.example.sch.id/oidc
CBT_INTEGRATION_API_KEY=RANDOM_SHARED_INTEGRATION_KEY
```

Kemudian:

```bash
cd /home/CPANEL_USER/apps/portal-data/laravel
chmod 600 .env
chmod -R 775 storage bootstrap/cache
php artisan optimize:clear
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

Pastikan `public/build/manifest.json` tersedia. Jika tidak ada, halaman React Portal Data tidak dapat memuat asset production.

## 8. Environment CBT

Buat `/home/CPANEL_USER/apps/cbt-man1/.env` berdasarkan `.env.example`:

```env
APP_NAME="CBT MAN 1 PALEMBANG"
APP_ENV=production
APP_DEBUG=false
APP_URL=https://cbt.example.sch.id
APP_TIMEZONE=Asia/Jakarta
APP_KEY=RANDOM_CBT_ENCRYPTION_KEY
SETUP_TOKEN=RANDOM_ONE_TIME_SETUP_TOKEN

DB_HOST=localhost
DB_PORT=3306
DB_DATABASE=CPANEL_USER_cbt
DB_USERNAME=CPANEL_USER_cbt_user
DB_PASSWORD=PASSWORD_DATABASE_CBT

PORTAL_DATA_BASE_URL=https://sipadu.example.sch.id
PORTAL_DATA_API_KEY=RANDOM_SHARED_INTEGRATION_KEY
PORTAL_DATA_TIMEOUT=5
PORTAL_DATA_VERIFY_SSL=true

SESSION_SECURE_COOKIE=true
SESSION_SAME_SITE=Lax
SESSION_LIFETIME=7200
```

`APP_KEY` CBT tidak boleh berubah setelah PIN siswa dibuat karena digunakan untuk enkripsi PIN kartu ujian.

```bash
cd /home/CPANEL_USER/apps/cbt-man1
chmod 600 .env
chmod -R 775 storage/logs storage/cache storage/imports
php database/migrate.php
php scripts/preflight.php
```

Jika tidak ada Terminal/SSH, import `database/schema.sql` melalui phpMyAdmin. Jalankan preflight di komputer staging dengan konfigurasi yang setara; jangan membuat script preflight dapat dipanggil dari web.

## 9. Initial admin CBT

Initial admin hanya dapat dibuat jika belum ada admin. Ambil CSRF dahulu dengan browser/dev tool atau cURL yang menyimpan cookie:

```bash
curl -c cookie.txt https://cbt.example.sch.id/api/auth/me
```

Ambil `csrf_token` dari response, lalu:

```bash
curl -b cookie.txt -X POST https://cbt.example.sch.id/api/setup/admin \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: TOKEN_CSRF" \
  -d '{"setup_token":"ONE_TIME_TOKEN","username":"adminsekolah","name":"Administrator Sekolah","password":"PASSWORD_KUAT_MINIMAL_12"}'
```

Setelah sukses, hapus `SETUP_TOKEN` dari `.env`. Jangan menyimpan `cookie.txt` atau command berisi secret di folder publik.

## 10. Urutan sinkronisasi pertama

1. Pastikan data tahun ajaran, kelas, siswa, guru, NISN, dan NIP di Portal Data sudah benar.
2. Login administrator CBT.
3. Sinkronkan kelas.
4. Sinkronkan siswa.
5. Sinkronkan guru.
6. Buat akun guru CBT memakai NIP sebagai username dan password awal kuat.
7. Buat ujian dan assignment guru.
8. Atur PIN CBT siswa.

Login guru tersedia di `/guru`; dashboard berada di `/guru/dashboard`. Guru tidak dapat masuk melalui modal login administrator.

## 11. Hosting yang tidak dapat mengubah document root

Pilihan terbaik tetap meminta provider mengarahkan subdomain ke folder `public`. Jika tidak mungkin:

1. Simpan seluruh aplikasi di `/home/CPANEL_USER/apps/cbt-man1`.
2. Salin `deploy/public-html-index.php.example` menjadi `public_html/cbt/index.php`.
3. Ganti `$applicationRoot` dengan absolute path yang sudah diverifikasi.
4. Salin `deploy/public-html-htaccess.example` menjadi `public_html/cbt/.htaccess`.
5. Salin/symlink asset public ke `public_html/cbt/assets` melalui File Manager.

Jangan menyalin `.env`, `app`, `database`, `storage`, `vendor`, atau file SQL ke `public_html`. Untuk Portal Data gunakan pola front-controller Laravel yang sama dan pastikan asset `public/build` ikut tersedia.

## 12. Verifikasi non-visual setelah deploy

```bash
curl -i https://sipadu.example.sch.id/health
curl -i https://cbt.example.sch.id/health
```

Endpoint integration tanpa key harus menghasilkan `401`:

```bash
curl -i https://sipadu.example.sch.id/api/v1/integration/cbt/teachers
```

Dengan key harus menghasilkan `200` dan tidak mengandung password:

```bash
curl -H "X-API-Key: RANDOM_SHARED_INTEGRATION_KEY" \
  "https://sipadu.example.sch.id/api/v1/integration/cbt/teachers?page=1&per_page=2"
```

Checklist:

- `APP_DEBUG=false` pada kedua aplikasi.
- HTTP dialihkan ke HTTPS.
- Response cookie memiliki `Secure`, `HttpOnly`, dan `SameSite`.
- `/health` CBT melaporkan database `ok`.
- API Portal tanpa key ditolak.
- Sinkronisasi kelas, siswa, dan guru menghasilkan summary.
- Login guru memakai NIP dan hanya melihat ujian assigned.
- Login siswa mempertahankan leading zero NISN.
- Refresh attempt tidak mengubah `expires_at` atau urutan soal.
- Jawaban tersimpan setelah refresh.
- Log teknis masuk ke `storage/logs`, bukan tampil di response.

## 13. Backup dan update release

Sebelum update:

```bash
mkdir -p /home/CPANEL_USER/backups/$(date +%F)
mysqldump --single-transaction -u PORTAL_DB_USER -p PORTAL_DB > /home/CPANEL_USER/backups/$(date +%F)/portal.sql
mysqldump --single-transaction -u CBT_DB_USER -p CBT_DB > /home/CPANEL_USER/backups/$(date +%F)/cbt.sql
```

Update Portal Data:

```bash
php artisan down --secret="RANDOM_BYPASS"
git pull --ff-only origin main
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
php artisan migrate --force
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan up
```

Update CBT:

```bash
git pull --ff-only origin main
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
php database/migrate.php
php scripts/preflight.php
```

Untuk update tanpa downtime panjang, upload release ke folder baru, salin `.env`, jalankan migration, lalu ubah document root/symlink setelah preflight lulus.

## 14. Rollback

1. Aktifkan maintenance page atau batasi akses.
2. Arahkan document root kembali ke release sebelumnya.
3. Restore database hanya jika migration/data release baru tidak backward-compatible.
4. Jangan restore database CBT ketika ujian sedang aktif tanpa keputusan operasional sekolah; jawaban setelah waktu backup akan hilang.
5. Jalankan health check dan non-visual smoke test sebelum membuka trafik.

## 15. Troubleshooting

- `500` setelah upload: cek versi PHP, `vendor`, permission storage, `.env`, dan log aplikasi.
- `419 CSRF`: pastikan domain cookie benar, HTTPS aktif, dan client mengambil CSRF dengan cookie yang sama.
- Guru tidak dapat login: sync guru, pastikan NIP tidak kosong, akun CBT menggunakan NIP yang sama, `teacher_id` terhubung, dan status keduanya aktif.
- Sync `401`: samakan `CBT_INTEGRATION_API_KEY` Portal dengan `PORTAL_DATA_API_KEY` CBT, lalu `php artisan config:cache` ulang.
- Sync timeout: periksa DNS/SSL/firewall outbound hosting; active exam tetap memakai database CBT lokal.
- Asset Portal Data kosong: build lokal dan upload `public/build`, lalu periksa `manifest.json`.
- PIN tampil `BELUM DISET`: atur `APP_KEY` dan set ulang PIN dari admin CBT.
- Perubahan `.env` tidak terbaca di Laravel: jalankan `php artisan optimize:clear` lalu `php artisan config:cache`.

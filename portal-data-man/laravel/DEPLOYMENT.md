# Deployment Portal Data Laravel di cPanel

> Untuk deployment Portal Data bersama CBT MAN 1, termasuk API key server-to-server, urutan sync, health check, backup, dan rollback, gunakan juga `../../cbt/docs/deployment-shared-hosting.md` sebagai runbook utama.

Dokumen ini mencakup instalasi baru dan cutover dari Portal Data Node.js. Jalankan seluruh command dari direktori `laravel/`.

## Cara deploy release terbaru dari GitHub ke shared hosting

Repository berisi beberapa aplikasi lama dan folder Laravel. Source production Laravel berada di:

```text
repository/laravel
```

Gunakan salah satu cara berikut. Jangan menaruh GitHub Personal Access Token di URL remote, file `.env`, atau command yang tersimpan di history shell.

### Opsi A — cPanel Git Version Control / SSH

Clone repository sekali saja di luar `public_html`:

```bash
cd /home/CPANEL_USER/apps
git clone https://github.com/mhdarif09/portal-data-man.git portal-data-man
cd /home/CPANEL_USER/apps/portal-data-man/laravel
```

Untuk update release berikutnya:

```bash
cd /home/CPANEL_USER/apps/portal-data-man
git fetch origin
git checkout main
git pull --ff-only origin main
cd laravel
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
php artisan migrate --force
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

Jika hosting tidak menyediakan Composer, jalankan `composer install --no-dev --prefer-dist --optimize-autoloader` di komputer lokal dengan PHP versi yang kompatibel, lalu upload folder `vendor/`. Jangan upload `node_modules/`.

### Opsi B — cPanel File Manager / FTP

1. Di komputer lokal, build asset dari folder `laravel/`:

   ```bash
   npm ci
   npm run build
   ```

2. Upload source `laravel/` ke `/home/CPANEL_USER/apps/portal-data-man/laravel/`, termasuk `public/build/` hasil build.
3. Jangan upload `.env` lokal, `node_modules/`, atau folder test.
4. Buat `.env` production langsung di server berdasarkan `.env.example`.
5. Pastikan `vendor/` tersedia dari Composer server atau hasil Composer lokal.
6. Jalankan command Artisan pada bagian **Migration database** dan **Verifikasi dasar**.

### Document root wajib

Atur domain/subdomain di cPanel agar document root menunjuk langsung ke:

```text
/home/CPANEL_USER/apps/portal-data-man/laravel/public
```

Jangan menunjuk domain ke root repository atau `/laravel`, karena itu dapat membuka source code dan file `.env` ke publik.

### Production wajib HTTPS

Semua domain production harus menggunakan HTTPS. Gunakan konfigurasi berikut di `.env` server:

```env
APP_URL=https://sipadu.man1palembang.sch.id
APP_ENV=production
APP_DEBUG=false
SESSION_DOMAIN=null
SESSION_SECURE_COOKIE=true
SESSION_SAME_SITE=lax
OIDC_ISSUER=https://sipadu.man1palembang.sch.id/oidc
```

Setelah mengubah `.env`, bersihkan cache konfigurasi:

```bash
php artisan optimize:clear
php artisan config:cache
```

Aktifkan redirect HTTP→HTTPS di cPanel dan pastikan sertifikat valid. Cookie session dan alur OIDC tidak boleh digunakan melalui HTTP.

## Integrasi aplikasi Jurnal Kelas (agen)

Buat aplikasi SSO baru pada Portal Data dengan nilai berikut:

```text
Nama aplikasi: Jurnal Kelas
Slug: jurnal-kelas
Redirect URI: https://agen.rdmman1plg.sch.id/auth/sso/callback
Post logout redirect URI: https://agen.rdmman1plg.sch.id/login
Scope: openid profile email portal_data.read
```

Simpan `client_id` dan `client_secret` melalui `.env` aplikasi agen, bukan di Git. Setelah login, agen membaca referensi semester, kelas, dan siswa melalui endpoint `GET /api/v1/integration/periods`, `GET /api/v1/integration/classes`, dan `GET /api/v1/integration/classes/{publicId}/students` menggunakan scope `portal_data.read`.

### Akun guru dan export kredensial

Link aktivasi akun guru tetap berlaku. Saat akun dibuat, Portal Data menetapkan password awal acak yang hanya ditampilkan sekali pada layar/export admin; password disimpan dalam bentuk hash dan wajib diganti saat login pertama. Perlakukan file export username/password sebagai data rahasia dan hapus setelah dibagikan kepada guru.

### Urutan update aman

Sebelum update yang mengandung migration:

```bash
mysqldump --single-transaction -u DB_USER -p DB_NAME > /home/CPANEL_USER/backups/portal-data-before-update.sql
```

Lalu jalankan:

```bash
php artisan down --secret="RANDOM_MAINTENANCE_BYPASS"
git pull --ff-only origin main
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
php artisan migrate --force
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan up
```

Build frontend hanya perlu dijalankan di server jika source JavaScript ikut diubah dan server menyediakan Node.js. Jika tidak, build lokal lalu upload `public/build/` dari commit yang sama.

## Kebutuhan hosting

- PHP 8.2 atau lebih baru.
- MariaDB 10.6+ atau MySQL 8.
- Ekstensi PHP: `ctype`, `curl`, `dom`, `fileinfo`, `filter`, `hash`, `intl`, `mbstring`, `openssl`, `pdo_mysql`, `session`, `simplexml`, `tokenizer`, `xml`, `xmlreader`, `xmlwriter`, dan `zip`.
- Composer 2.
- Apache `mod_rewrite` atau konfigurasi rewrite ekuivalen.
- Node.js hanya dibutuhkan saat membangun asset. Asset dapat dibangun lokal lalu diunggah bila cPanel tidak menyediakan Node.

Document root domain/subdomain harus menunjuk ke folder `laravel/public`, bukan root repository dan bukan folder `laravel`.

## Struktur production

```text
/home/CPANEL_USER/apps/portal-data/laravel
├── app
├── bootstrap
├── config
├── public                 <- document root
├── resources
├── routes
├── storage                <- wajib writable
├── vendor
├── artisan
└── .env                   <- permission 600, jangan masuk Git
```

## Backup sebelum cutover

Jangan jalankan migration production sebelum backup database dan storage selesai.

```bash
mkdir -p /home/CPANEL_USER/backups/portal-data
mysqldump --single-transaction --routines --triggers \
  -u DB_USER -p DB_NAME \
  > /home/CPANEL_USER/backups/portal-data/before-laravel.sql
tar -czf /home/CPANEL_USER/backups/portal-data/storage-before-laravel.tar.gz \
  -C /home/CPANEL_USER/apps/portal-data/portal-data-man storage
```

Pastikan kedua backup memiliki ukuran masuk akal dan dapat dibaca. Jangan menyimpan dump di dalam `public/`.

## Upload atau clone aplikasi

```bash
cd /home/CPANEL_USER/apps
git clone REPOSITORY_URL portal-data
cd /home/CPANEL_USER/apps/portal-data/portal-data-man/laravel
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
```

Jika repository sudah tersedia:

```bash
git pull --ff-only origin main
cd laravel
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
```

## Environment production

```bash
cp .env.example .env
chmod 600 .env
php artisan key:generate
```

Isi `.env` production:

```env
APP_NAME="Portal Data"
APP_ENV=production
APP_DEBUG=false
APP_URL=https://sipadu.man1palembang.sch.id
APP_LOCALE=id

DB_CONNECTION=mysql
DB_HOST=localhost
DB_PORT=3306
DB_DATABASE=cpuser_portal_data
DB_USERNAME=cpuser_portal_user
DB_PASSWORD=PASSWORD_DATABASE

SESSION_DRIVER=file
SESSION_LIFETIME=480
SESSION_ENCRYPT=true
SESSION_SECURE_COOKIE=true
SESSION_SAME_SITE=lax

CACHE_STORE=file
QUEUE_CONNECTION=sync
FILESYSTEM_DISK=local

MAIL_MAILER=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=portal@sekolah.sch.id
MAIL_PASSWORD=APP_PASSWORD_SMTP
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS=portal@sekolah.sch.id
MAIL_FROM_NAME="Portal Data"

SUPER_ADMIN_NAME="Administrator Sekolah"
SUPER_ADMIN_EMAIL=admin@sekolah.sch.id
SUPER_ADMIN_PASSWORD=PASSWORD_AWAL_MINIMAL_12_KARAKTER

IMPORT_MAX_ROWS=5000
IMPORT_MAX_FILE_SIZE_MB=10
EXPORT_MAX_ROWS=10000

OIDC_ISSUER=https://sipadu.man1palembang.sch.id/oidc
OIDC_KEY_ID=portal-data-production-1
OIDC_ACCESS_TOKEN_TTL=900
OIDC_AUTHORIZATION_CODE_TTL=600

# Backend-only integration untuk CBT; samakan dengan PORTAL_DATA_API_KEY di CBT.
CBT_INTEGRATION_API_KEY=RANDOM_MINIMAL_32_KARAKTER
```

Jangan menyalin kredensial development ke production. Ganti password database, password super-admin, SMTP App Password, dan `APP_KEY`.

## Signing key OIDC

Buat signing key persisten satu kali sebelum aplikasi SSO digunakan:

```bash
php artisan portal:oidc-key-generate
```

Private key disimpan di `storage/app/private/oidc/private.pem` dengan permission `600`. Backup key ini secara terenkripsi. Jangan menjalankan command dengan `--force` pada deployment rutin karena rotasi mendadak membuat token yang masih aktif gagal diverifikasi.

Endpoint provider:

- Discovery: `https://sipadu.man1palembang.sch.id/oidc/.well-known/openid-configuration`
- Authorization: `https://sipadu.man1palembang.sch.id/oidc/authorize`
- Token: `https://sipadu.man1palembang.sch.id/oidc/token`
- UserInfo: `https://sipadu.man1palembang.sch.id/oidc/userinfo`
- JWKS: `https://sipadu.man1palembang.sch.id/oidc/jwks`

Client web publik wajib memakai Authorization Code, PKCE `S256`, dan redirect URI exact-match yang didaftarkan dari menu Aplikasi SSO.

## Permission storage

```bash
mkdir -p storage/app/private/imports \
  storage/app/private/import-errors \
  storage/app/private/teacher-photos \
  storage/framework/cache storage/framework/sessions \
  storage/framework/views storage/logs bootstrap/cache
chmod -R u+rwX,g+rwX storage bootstrap/cache
find storage/app/private -type f -exec chmod 600 {} \;
```

Gunakan group user web server yang disediakan hosting. Hindari permission `777`.

## Memindahkan storage lama

Database lama menyimpan nama file, bukan isi file. Salin file privat secara terpisah:

```bash
cp -a ../storage/imports/. storage/app/private/imports/
cp -a ../storage/import-errors/. storage/app/private/import-errors/
cp -a ../storage/teacher-photos/. storage/app/private/teacher-photos/ 2>/dev/null || true
```

Untuk batch lama, nama fisik file mengikuti `ImportBatch.storedFilename`. Jangan meletakkan import, foto, atau dump SQL di `public/`.

## Build asset

Jika Node tersedia di cPanel:

```bash
npm ci
npm run build
```

Untuk build lokal, jalankan `npm ci && npm run build`, lalu unggah seluruh `public/build/`. Manifest dan nama asset hash harus berasal dari build yang sama.
Pada repository ini `public/build/` sudah dilacak Git agar deploy melalui `git pull` di shared hosting ikut membawa `manifest.json` dan asset production.

## Migration database

Migration mendukung dua jalur:

1. Database kosong: seluruh schema Portal Data dibuat.
2. Database Node/Prisma lama yang lengkap: tabel lama diadopsi dan diverifikasi tanpa menghapus data.

Database yang hanya memiliki sebagian tabel akan ditolak. Jangan menggunakan `migrate:fresh` pada database berisi data.

```bash
php artisan migrate:status
php artisan migrate --force
php artisan db:seed --force
```

Seeder melakukan upsert berdasarkan `SUPER_ADMIN_EMAIL`. Menjalankannya ulang tidak membuat akun duplikat, tetapi akan mengganti password akun tersebut dengan nilai environment saat ini.

Verifikasi dasar:

```bash
php artisan about
php artisan migrate:status
php artisan route:list --path=api/v1
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

## Konfigurasi domain cPanel

Di cPanel Domains/Subdomains, atur document root:

```text
/home/CPANEL_USER/apps/portal-data/portal-data-man/laravel/public
```

Pastikan `.htaccess` pada `public/` ikut terunggah. Akses ke folder root aplikasi, `.env`, `storage`, dan backup tidak boleh tersedia dari HTTP.

## Smoke test setelah cutover

```bash
curl -I https://sipadu.man1palembang.sch.id/
curl -I https://sipadu.man1palembang.sch.id/up
```

Kemudian periksa melalui browser:

1. Login super-admin.
2. Dashboard menampilkan 690 siswa, 20 kelas, dan data guru sesuai database.
3. Daftar siswa dan guru dapat dibaca.
4. Template XLSX dapat diunduh.
5. Validasi import bekerja; jangan commit ulang batch produksi hanya untuk smoke test.
6. Email aktivasi guru terkirim melalui SMTP.
7. `storage/logs/laravel.log` tidak memuat exception baru.

## Update berikutnya

```bash
cd /home/CPANEL_USER/apps/portal-data/portal-data-man/laravel
php artisan down --secret="RANDOM_MAINTENANCE_BYPASS"
git pull --ff-only origin main
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
npm ci
npm run build
php artisan migrate --force
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan up
```

Backup database sebelum migration setiap release.

## Rollback cutover

Migration baseline sengaja tidak menyediakan rollback destruktif. Jika cutover gagal:

1. Arahkan document root kembali ke aplikasi lama.
2. Restore dump database hanya jika Laravel sudah menulis data yang tidak kompatibel.
3. Restore archive storage bila file berubah.
4. Simpan log Laravel untuk diagnosis.

Jangan menjalankan `php artisan migrate:rollback`, `migrate:reset`, atau `migrate:fresh` pada production.

## Kapan source Node lama boleh dihapus

Hapus `apps/api`, `apps/web`, `prisma`, root `node_modules`, dan artefak Node hanya setelah:

- seluruh route dan UI mencapai parity;
- SSO/OIDC Laravel sudah teruji dengan aplikasi klien;
- SMTP dan portal guru sudah teruji;
- minimal satu backup restore drill berhasil;
- aplikasi Laravel stabil di production selama periode observasi yang disepakati.

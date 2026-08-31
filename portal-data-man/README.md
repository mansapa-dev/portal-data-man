# Portal Data

Portal Data adalah master data sekolah sekaligus Identity Provider OpenID Connect untuk aplikasi internal seperti Jurnal Kelas. Aplikasi ini mengelola siswa, guru, kelas, periode akademik, enrollment, import/export, akun guru, dan akses SSO.

Produksi berjalan sebagai satu aplikasi Node.js: NestJS melayani REST API, OIDC, dan hasil build React. Deployment ini tidak membutuhkan Docker, Redis, atau web server Node terpisah.

## Daftar isi

1. [Arsitektur](#arsitektur)
2. [Persyaratan](#persyaratan)
3. [Menjalankan secara lokal](#menjalankan-secara-lokal)
4. [Persiapan sebelum push](#persiapan-sebelum-push)
5. [Deployment cPanel](#deployment-cpanel-shared-hosting)
6. [Konfigurasi environment production](#environment-production)
7. [Database, migration, dan seed](#database-migration-dan-seed)
8. [Build dan restart](#build-dan-restart-aplikasi)
9. [Update deployment](#update-versi-berikutnya)
10. [Verifikasi](#verifikasi-production)
11. [Backup dan cron](#backup-dan-cron)
12. [Troubleshooting](#troubleshooting)

## Arsitektur

```text
Browser / aplikasi sekolah
           │ HTTPS
           ▼
 cPanel Passenger / reverse proxy
           │
           ▼
 Node.js — app.cjs
           │
           └── NestJS
               ├── React SPA       /
               ├── REST API        /api/v1
               ├── OpenID Connect  /oidc
               ├── Swagger         /docs (opsional)
               └── Health check    /health
                         │
                         ▼
                       MySQL 8
```

Komponen repository:

| Lokasi | Fungsi |
|---|---|
| `apps/api` | NestJS API, autentikasi, dan OIDC provider |
| `apps/web` | React/Vite admin dan portal guru |
| `packages/shared` | Kontrak/type bersama |
| `prisma` | Schema, migration SQL, dan seed super-admin |
| `storage` | File privat import, export, foto, dan temporary |
| `scripts` | Build, startup shared hosting, dan cleanup |
| `dist/server` | Hasil build backend |
| `dist/public` | Hasil build frontend |
| `app.cjs` | Startup file cPanel/Passenger |

> Gunakan `publicId`/ULID untuk integrasi. Internal numeric ID database tidak termasuk kontrak API.

## Persyaratan

- Node.js **22 LTS direkomendasikan**. Minimum Node.js `20.19`.
- npm 10 atau lebih baru.
- MySQL 8 atau MariaDB yang kompatibel dengan schema Prisma MySQL.
- cPanel dengan **Setup Node.js App**, Terminal/SSH, dan MySQL Database Wizard.
- Domain atau subdomain dengan SSL aktif.
- RAM dan process limit hosting yang cukup untuk build TypeScript/Vite. Jika build dibunuh karena limit, build secara lokal dan unggah `dist/`.

Periksa versi:

```bash
node --version
npm --version
mysql --version
```

## Menjalankan secara lokal

Jalankan dari application root, yaitu direktori yang berisi `package.json`, `apps/`, dan `prisma/`.

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run seed
npm run dev
```

Frontend development dijalankan pada terminal lain:

```bash
npm run dev:web
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000/api/v1`
- OIDC issuer: `http://localhost:3000/oidc`
- Health: `http://localhost:3000/health`

## Persiapan sebelum push

Jangan push `.env`, spreadsheet siswa, database dump, private JWK, SMTP App Password, cookie, atau file storage produksi.

Jalankan quality gate:

```bash
npm install
npm run prisma:generate
npm run lint
npm run typecheck
npm run test
npm run build
```

Pastikan output berikut tersedia:

```bash
test -f dist/server/main.js
test -f dist/public/index.html
test -f app.cjs
```

Periksa perubahan, lalu commit dan push:

```bash
git status
git diff --check
git add .
git commit -m "docs: add cPanel deployment guide"
git push origin main
```

> Repository workspace ini memakai application root `portal-data-man/`. Setelah clone/pull, masuk ke folder yang benar dan pastikan `package.json` tersedia sebelum menjalankan npm. Jangan menjalankan install dari parent directory yang tidak memiliki `package.json`.

## Deployment cPanel shared hosting

Gunakan subdomain khusus, misalnya `portal.sekolah.sch.id`. Deployment di root subdomain lebih sederhana dan aman untuk callback OIDC dibanding deployment di subpath.

### 1. Buat database MySQL

Di **cPanel → MySQL Database Wizard**:

1. Buat database, misalnya `cpuser_portal_data`.
2. Buat user database dengan password acak yang kuat.
3. Berikan **ALL PRIVILEGES** kepada user tersebut pada database.
4. Catat hostname MySQL. Pada kebanyakan shared hosting nilainya `localhost`, tetapi ikuti informasi provider.
5. Jangan import schema manual. Prisma migration akan membuat tabel.

Nama database dan user cPanel biasanya otomatis memiliki prefix username cPanel.

Contoh URL:

```env
DATABASE_URL=mysql://cpuser_portal_user:PASSWORD_URL_ENCODED@localhost:3306/cpuser_portal_data
```

Karakter khusus pada username/password harus di-URL-encode. Contoh: `@` menjadi `%40`, `#` menjadi `%23`, dan `/` menjadi `%2F`.

### 2. Clone repository melalui Terminal

Untuk repository publik:

```bash
mkdir -p /home/CPANEL_USER/apps
cd /home/CPANEL_USER/apps
git clone https://github.com/mhdarif09/portal-data-man.git portal-data
cd /home/CPANEL_USER/apps/portal-data/portal-data-man
test -f package.json
```

Untuk repository private, gunakan SSH deploy key atau Personal Access Token dengan akses repository minimal. Jangan menyimpan token di remote URL atau shell history.

Alternatif: gunakan **cPanel → Git Version Control**, clone repository ke `/home/CPANEL_USER/apps/portal-data`, kemudian tetap gunakan application root yang berisi `package.json`.

### 3. Buat aplikasi Node.js

Buka **cPanel → Setup Node.js App → Create Application**:

| Field cPanel | Nilai |
|---|---|
| Node.js version | `22.x` jika tersedia |
| Application mode | `Production` |
| Application root | `apps/portal-data/portal-data-man` |
| Application URL | `portal.sekolah.sch.id` |
| Application startup file | `app.cjs` |

Jangan memilih `dist/public` sebagai application root. Passenger harus menjalankan Node.js melalui `app.cjs`; NestJS yang akan melayani frontend.

Setelah aplikasi dibuat, cPanel menampilkan command untuk mengaktifkan virtual environment Node. Salin command tersebut karena path-nya berbeda pada setiap hosting. Bentuk umumnya:

```bash
source /home/CPANEL_USER/nodevenv/apps/portal-data/22/bin/activate
cd /home/CPANEL_USER/apps/portal-data/portal-data-man
```

### 4. Install dependency

Build membutuhkan dev dependency seperti TypeScript, Vite, Prisma CLI, dan `tsx`:

```bash
npm ci --include=dev
npm run prisma:generate
```

Gunakan `npm ci`, bukan menghapus lockfile. Jika hosting hanya menyediakan tombol **Run NPM Install**, pastikan dev dependency tidak dilewati saat build pertama.

Jika native module `argon2` gagal terpasang, periksa versi Node dan compiler yang disediakan hosting. Node 22 LTS biasanya memiliki binary yang kompatibel. Hubungi provider jika proses native binary diblokir.

### 5. Buat direktori writable

```bash
mkdir -p storage/imports storage/import-errors storage/exports storage/temporary storage/teacher-photos tmp
chmod 750 storage storage/imports storage/import-errors storage/exports storage/temporary storage/teacher-photos tmp
```

Folder `storage/` harus writable oleh process Node tetapi tidak boleh menjadi document root atau dapat diakses langsung sebagai file statis.

## Environment production

Environment dapat dimasukkan melalui **Setup Node.js App → Environment Variables**. Jika provider mengizinkan `.env`, buat file tersebut pada application root dan set permission `600`.

Contoh production:

```env
NODE_ENV=production
PORT=3000
APP_NAME="Portal Data"
APP_URL=https://portal.sekolah.sch.id
API_PREFIX=api/v1
TRUST_PROXY=1

DATABASE_URL=mysql://cpuser_portal_user:PASSWORD_URL_ENCODED@localhost:3306/cpuser_portal_data

SESSION_SECRET=RANDOM_SECRET_MINIMUM_48_BYTES
CSRF_SECRET=RANDOM_SECRET_MINIMUM_48_BYTES
COOKIE_DOMAIN=portal.sekolah.sch.id
COOKIE_SECURE=true
CORS_ORIGINS=https://portal.sekolah.sch.id

OIDC_ISSUER=https://portal.sekolah.sch.id/oidc
OIDC_JWKS_JSON={"keys":[{"kty":"RSA","n":"...","e":"AQAB","d":"...","p":"...","q":"...","dp":"...","dq":"...","qi":"...","kid":"portal-data-prod-1","use":"sig","alg":"RS256"}]}
OIDC_COOKIE_KEYS=RANDOM_KEY_ONE,RANDOM_KEY_TWO
OIDC_ACCESS_TOKEN_TTL=900
OIDC_REFRESH_TOKEN_TTL=2592000
OIDC_AUTHORIZATION_CODE_TTL=600

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=portal.sekolah@gmail.com
SMTP_PASS=GOOGLE_APP_PASSWORD
SMTP_FROM="Portal Data <portal.sekolah@gmail.com>"

SWAGGER_ENABLED=false
STORAGE_PATH=./storage
IMPORT_MAX_FILE_SIZE_MB=10
IMPORT_MAX_ROWS=5000
DEFAULT_PAGE_SIZE=25
MAX_PAGE_SIZE=100
RATE_LIMIT_TTL_MS=60000
RATE_LIMIT_MAX=120
LOGIN_RATE_LIMIT_MAX=5
LOG_LEVEL=info

SUPER_ADMIN_NAME="Administrator Sekolah"
SUPER_ADMIN_EMAIL=admin@sekolah.sch.id
SUPER_ADMIN_PASSWORD=PASSWORD_AWAL_MINIMUM_12_KARAKTER
```

Catatan:

- Jangan memaksa `PORT` jika cPanel menyuntikkan port Passenger secara otomatis. Environment cPanel memiliki prioritas; aplikasi membaca `process.env.PORT`.
- `APP_URL`, `OIDC_ISSUER`, `CORS_ORIGINS`, domain SSL, dan redirect URI aplikasi SSO harus konsisten.
- Untuk satu subdomain, `COOKIE_DOMAIN` boleh dikosongkan agar cookie menjadi host-only. Ini lebih ketat dan direkomendasikan.
- `COOKIE_SECURE=true` membutuhkan HTTPS.
- Matikan Swagger di production kecuali benar-benar dibutuhkan.
- Gmail memerlukan 2-Step Verification dan **Google App Password**, bukan password Gmail biasa.

### Generate secret

Jalankan beberapa kali dan simpan hasilnya hanya di environment cPanel:

```bash
openssl rand -base64 48
```

Gunakan nilai berbeda untuk `SESSION_SECRET`, `CSRF_SECRET`, dan dua item `OIDC_COOKIE_KEYS`.

### Generate persistent OIDC signing key

Jalankan satu kali pada mesin yang aman:

```bash
node -e "const{generateKeyPairSync}=require('node:crypto');const{privateKey}=generateKeyPairSync('rsa',{modulusLength:3072});const j=privateKey.export({format:'jwk'});console.log(JSON.stringify({keys:[{...j,kid:'portal-data-prod-1',use:'sig',alg:'RS256'}]}))"
```

Masukkan output satu baris ke `OIDC_JWKS_JSON`. Private JWK tidak boleh masuk Git, screenshot, tiket dukungan, atau log. Backup key secara terenkripsi. Jangan membuat key baru pada setiap deploy karena token yang ditandatangani key lama akan gagal diverifikasi.

## Database, migration, dan seed

Pastikan `DATABASE_URL` production sudah aktif pada terminal yang sama.

```bash
npm run prisma:generate
npm run prisma:migrate
npm run seed
```

`npm run prisma:migrate` menjalankan `prisma migrate deploy`, bukan `db push`. Migration yang tersedia:

- `20260829193500_initial`
- `20260830072000_teacher_accounts`

Seed bersifat upsert berdasarkan email super-admin. Password minimal 12 karakter. Setelah login pertama, ganti password melalui halaman profil dan perbarui/hapus nilai `SUPER_ADMIN_PASSWORD` dari konfigurasi jika prosedur operasional hosting mengizinkan.

Periksa status migration:

```bash
npx prisma migrate status
```

Jangan menjalankan `prisma migrate dev`, `prisma db push`, atau mengedit migration yang sudah diterapkan pada production.

## Build dan restart aplikasi

Build lengkap:

```bash
npm run build
test -f dist/server/main.js
test -f dist/public/index.html
```

Tes startup manual hanya jika port terminal diizinkan hosting:

```bash
npm run start:prod
```

Hentikan proses manual setelah pemeriksaan karena Passenger yang harus mengelola process production.

Restart melalui tombol **Restart Application** di Setup Node.js App. Pada hosting Passenger yang mendukung restart file:

```bash
mkdir -p tmp
touch tmp/restart.txt
```

## Update versi berikutnya

Selalu backup database dan storage sebelum migration production.

```bash
source /home/CPANEL_USER/nodevenv/apps/portal-data/22/bin/activate
cd /home/CPANEL_USER/apps/portal-data/portal-data-man
git status
git pull --ff-only origin main
npm ci --include=dev
npm run prisma:generate
npm run build
npm run prisma:migrate
touch tmp/restart.txt
```

Kemudian jalankan verifikasi health dan login. Jangan memakai `git reset --hard` pada server karena dapat menghapus perubahan atau file operasional yang belum dicadangkan.

Untuk deployment yang lebih aman, tag release sebelum push:

```bash
git tag -a v1.0.0 -m "Portal Data v1.0.0"
git push origin v1.0.0
```

Rollback source tidak otomatis mengembalikan schema database. Migration Prisma harus dirancang forward-only atau dipulihkan dari backup oleh operator yang memahami dampaknya.

## Verifikasi production

```bash
curl -i https://portal.sekolah.sch.id/health
curl -i https://portal.sekolah.sch.id/oidc/.well-known/openid-configuration
curl -I https://portal.sekolah.sch.id/
```

Health yang benar mengembalikan HTTP `200` dan database `connected`.

Checklist browser:

- Halaman admin dapat dibuka dan login super-admin berhasil.
- Refresh pada deep link seperti `/teachers` tidak menghasilkan 404.
- Cookie memiliki flag `Secure` dan session admin bersifat `HttpOnly`.
- CRUD sederhana dan upload foto berhasil menulis ke `storage/`.
- Akun guru dapat dibuat dan email aktivasi terkirim.
- Guru dapat mengatur password lalu login.
- Discovery OIDC menampilkan issuer HTTPS yang tepat.
- Login SSO kembali ke redirect URI aplikasi yang terdaftar.
- Tidak ada private key, password, atau cookie pada log.

## Backup dan cron

Backup minimum:

1. Database MySQL melalui fitur Backup cPanel atau `mysqldump`.
2. Seluruh folder `storage/`.
3. Environment production dan private OIDC JWK secara terenkripsi.
4. Catatan versi/tag Git yang sedang berjalan.

Contoh backup database interaktif:

```bash
mysqldump --single-transaction -u CPANEL_DB_USER -p CPANEL_DATABASE > portal-data-YYYY-MM-DD.sql
```

Jangan simpan dump di `public_html`. Pindahkan ke backup storage yang terenkripsi dan memiliki retention policy.

Tambahkan cron harian melalui **cPanel → Cron Jobs** untuk membersihkan temporary file. Gunakan absolute path Node dari virtual environment cPanel:

```text
15 2 * * * /home/CPANEL_USER/nodevenv/apps/portal-data/22/bin/node /home/CPANEL_USER/apps/portal-data/portal-data-man/scripts/cleanup-temporary-files.mjs
```

Cron tersebut hanya menghapus file dalam `storage/temporary` yang lebih lama dari 24 jam.

## Troubleshooting

### 503 Service Unavailable

- Pastikan startup file adalah `app.cjs`.
- Pastikan `dist/server/main.js` tersedia.
- Pastikan Node version sesuai.
- Buka **Setup Node.js App → Restart Application**.
- Periksa Passenger/application error log di cPanel.

### Cannot find module `dist/server/main.js`

```bash
npm ci --include=dev
npm run build
test -f dist/server/main.js
```

Jangan mengubah startup file ke source TypeScript. Production harus menjalankan JavaScript hasil build.

### Prisma Client belum di-generate

```bash
npm run prisma:generate
touch tmp/restart.txt
```

### Prisma P1000/P1001/P1045

- Periksa hostname, port, nama database, username, dan password.
- Pastikan user mendapat ALL PRIVILEGES.
- URL-encode karakter khusus pada password.
- Jika database remote, whitelist IP server aplikasi.

### Tabel tidak ditemukan / migration pending

```bash
npx prisma migrate status
npm run prisma:migrate
```

Jangan memperbaiki production dengan `prisma db push`.

### Login berhasil tetapi kembali ke halaman login

- Pastikan domain di browser sama dengan `APP_URL`.
- Gunakan HTTPS dan `COOKIE_SECURE=true`.
- Kosongkan `COOKIE_DOMAIN` jika hanya memakai satu host.
- Pastikan reverse proxy meneruskan HTTPS dan `TRUST_PROXY=1`.
- Hapus cookie lama setelah mengganti domain.

### Token CSRF tidak valid

- Pastikan request memakai cookie dan hostname yang sama.
- Jangan mencampur `www`, non-`www`, IP, dan subdomain dalam satu sesi.
- Periksa header `X-CSRF-Token` pada request mutasi.
- Logout/login kembali setelah perubahan konfigurasi cookie.

### OIDC `redirect_uri` tidak valid

- Redirect URI harus exact-match termasuk scheme, host, port, path, dan trailing slash.
- Production wajib memakai HTTPS kecuali localhost development.
- Pastikan aplikasi SSO berstatus aktif dan guru sudah diberi akses.
- Pastikan `OIDC_ISSUER` identik dengan issuer pada discovery document.

### Email aktivasi tidak terkirim

- Gunakan Gmail App Password.
- Pastikan `SMTP_PORT=587` dan `SMTP_SECURE=false`, atau port `465` dengan secure `true`.
- Pastikan alamat guru tersedia.
- Periksa apakah provider memblokir koneksi SMTP outbound.
- UI tetap menampilkan setup URL sebagai fallback jika SMTP gagal.

### Upload/import gagal karena permission

```bash
chmod 750 storage storage/imports storage/import-errors storage/exports storage/temporary storage/teacher-photos
```

Jika process Passenger berjalan sebagai user berbeda, minta provider memperbaiki ownership. Jangan menggunakan permission `777` kecuali diagnosis sementara atas arahan provider.

### Build kehabisan memory

Build pada mesin lokal dengan versi Node yang sama, lalu unggah `dist/` bersama source dan lockfile. Server tetap membutuhkan dependency runtime dan Prisma Client. Jalankan install lengkap sementara untuk menyediakan Prisma CLI, generate client, lalu restart:

```bash
npm ci --include=dev
npm run prisma:generate
touch tmp/restart.txt
```

Dev dependency boleh dipangkas setelah build dan generate jika resource hosting sangat terbatas, tetapi uji startup kembali karena perilaku npm workspace dan native module dapat berbeda antar-provider.

### Build gagal `EACCES` pada `dist/`

Periksa ownership file hasil build:

```bash
find dist -maxdepth 2 -printf '%u:%g %m %p\n'
```

File hasil build harus dimiliki user cPanel yang menjalankan npm. Jika dimiliki user Passenger atau user lain, minta provider memperbaiki ownership, lalu jalankan build ulang. Jangan menyelesaikannya dengan permission `777`.

### Bundle frontend warning di atas 500 kB

Ini warning performa, bukan build failure. Aplikasi tetap dapat dijalankan. Lakukan code splitting pada tahap optimasi terpisah.

## Perintah ringkas deployment pertama

Jalankan setelah database, Node.js App, dan environment production selesai dikonfigurasi:

```bash
source /home/CPANEL_USER/nodevenv/apps/portal-data/22/bin/activate
cd /home/CPANEL_USER/apps/portal-data/portal-data-man
test -f package.json
npm ci --include=dev
npm run prisma:generate
npm run build
npm run prisma:migrate
npm run seed
mkdir -p tmp storage/imports storage/import-errors storage/exports storage/temporary storage/teacher-photos
chmod 750 tmp storage storage/imports storage/import-errors storage/exports storage/temporary storage/teacher-photos
touch tmp/restart.txt
curl -i https://portal.sekolah.sch.id/health
```

Setelah deployment berhasil, simpan tag release, tanggal migration, hasil health check, dan lokasi backup pada catatan operasional sekolah.

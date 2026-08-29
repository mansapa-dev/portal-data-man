# Portal Data

Portal Data adalah sumber data utama siswa, guru, kelas, periode akademik, serta identitas guru untuk aplikasi internal sekolah. Transaksi seperti absensi, jurnal, nilai, dan peminjaman tetap menjadi milik aplikasi masing-masing.

## Arsitektur dan stack

Monorepo npm workspaces ini berisi NestJS REST API (`apps/api`), React/Vite (`apps/web`), kontrak bersama (`packages/shared`), Prisma/MySQL (`prisma`), dan private storage. Produksi berjalan sebagai satu proses Node.js; NestJS menyajikan hasil build React. Tidak memerlukan Docker, Redis, Keycloak, atau worker terpisah.

Keamanan dasar meliputi Argon2id, cookie HttpOnly, session persisten, CSRF token, account lockout, Helmet, CORS allowlist, validasi input ketat, rate limiting, audit model, dan redaksi secret pada structured logging. Internal numeric ID tidak dipakai sebagai identifier API.

## Instalasi lokal

Persyaratan: Node.js 20+, npm, dan MySQL 8.

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run seed
npm run dev
npm run dev:web
```

Isi seluruh secret di `.env`. Super admin hanya dibuat dari `SUPER_ADMIN_*`; kata sandi minimal 12 karakter dan tidak pernah di-hardcode. Frontend development ada di `http://localhost:5173`, API di port `PORT`, Swagger di `/docs`, dan health check di `/health`.

## Build dan shared hosting

```bash
npm install
npx prisma generate
npm run build
npx prisma migrate deploy
npm run start:prod
```

Set startup file panel hosting ke `scripts/shared-hosting-start.cjs`, document root ke root proyek, dan pastikan `storage/` writable tetapi tidak public. Jangan menjalankan migration otomatis saat startup. Konfigurasikan reverse proxy HTTPS dan `TRUST_PROXY=1`. Cron harian dapat menjalankan `node scripts/cleanup-temporary-files.mjs`; cleanup artefak OIDC kedaluwarsa juga harus dijadwalkan.

## Import siswa

Import dua tahap memakai `POST /api/v1/imports/students/validate` (multipart field `file`) lalu `POST /api/v1/imports/students/:publicId/commit`. Validasi tidak mengubah siswa. Commit diproses per 100 baris, menggunakan semester aktif, upsert NISN, membuat kelas/enrollment, dan aman dari commit ulang. File asli disimpan privat dengan mode terbatas.

Format: `No.`, `NISN`, `Nama Siswa`, `Kelas`, `No. Telepon Orang Tua`, `Alamat`, `RFID UID`, `Status`. Kolom `No.` diabaikan. Normalizer mempertahankan nol awal NISN, memperbaiki `XlI` menjadi `XII`, serta mengubah telepon/RFID invalid menjadi warning.

## Authentication dan integrasi

Admin login melalui `POST /api/v1/auth/admin/login`; browser menyimpan session pada cookie HttpOnly, bukan localStorage. Request mutasi mengirim cookie CSRF melalui header `X-CSRF-Token`. OIDC issuer direncanakan pada `/oidc` dengan Authorization Code + PKCE S256 untuk public web client dan Client Credentials untuk service client. Redirect URI wajib exact-match dan client secret hanya disimpan sebagai hash.

## Operasional

- Backup database dengan fasilitas MySQL hosting dan backup folder `storage/` secara terenkripsi.
- Gunakan HTTPS, CORS eksplisit, cookie secure, signing key berbeda per environment, serta rotasi secret.
- Generate signing key dengan OpenSSL, simpan private key hanya pada environment/secret manager hosting.
- Jalankan `npm test`, `npm run typecheck`, `npm run lint`, dan `npm run build` sebelum deploy.
- Spreadsheet siswa aktual tidak disertakan dalam repository; masukkan melalui UI/API import, bukan seed.

## Status implementasi

Fondasi runtime, schema lengkap, autentikasi admin, CRUD siswa, normalisasi/import siswa dua tahap, UI shell responsive, build shared hosting, seed aman, dan test normalizer telah tersedia. Modul besar lain pada spesifikasi (OIDC provider lengkap, seluruh CRUD, semua halaman, export, serta suite e2e) perlu dilanjutkan sebelum deployment production.

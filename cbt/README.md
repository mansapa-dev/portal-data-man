# CBT MAN 1 Palembang

CBT berjalan dengan PHP Native 8.2+, PDO, dan MySQL/MariaDB. `index.html` dipertahankan sebagai spesifikasi visual; `public/assets/js/native-api-adapter.js` menghubungkan UI ke HTTP API PHP.

## Kebutuhan

- PHP 8.2/8.3 dengan PDO MySQL, cURL, mbstring, fileinfo, zip, dan openssl
- MySQL 8 atau MariaDB yang mendukung JSON dan InnoDB
- Apache `mod_rewrite`; document root diarahkan ke folder `public`
- Composer 2 (dapat dijalankan lokal lalu folder `vendor` diunggah ke hosting)

## Instalasi

1. Salin `.env.example` ke `.env`, isi database serta credential API Portal Data.
2. Jalankan `composer install --no-dev --optimize-autoloader`.
3. Jalankan `composer migrate` atau import `database/schema.sql` lewat phpMyAdmin.
4. Jalankan `composer seed` untuk mengisi katalog mata pelajaran resmi secara idempotent.
5. Pastikan `storage/logs`, `storage/cache`, dan `storage/imports` writable oleh PHP.
6. Arahkan document root domain/subdomain ke `cbt/public`.
7. Ambil CSRF dari `GET /api/auth/me`, lalu buat admin pertama satu kali lewat `POST /api/setup/admin` dengan `setup_token`, `username`, `name`, dan password minimal 12 karakter.
8. Setelah berhasil, kosongkan/hapus `SETUP_TOKEN` dari `.env`.

## Portal Data

CBT memanggil Portal Data hanya dari backend menggunakan access token OAuth Client Credentials. Contract default:

- `GET /api/v1/integration/cbt/academic-years`
- `GET /api/v1/integration/cbt/semesters?academic_year_id=<portal_id>`
- `GET /api/v1/integration/cbt/students?page=1&per_page=100`
- `GET /api/v1/integration/cbt/teachers?page=1&per_page=100`
- `GET /api/v1/integration/cbt/classes?page=1&per_page=100`

Endpoint sync admin: `POST /api/admin/portal-data/sync/students`, `/teachers`, atau `/classes`. Sinkronisasi bersifat upsert berdasarkan ID Portal; NISN disimpan sebagai string. Saat Portal Data down, attempt aktif tetap memakai cache dan snapshot lokal CBT.

Daftarkan aplikasi bertipe **Sinkronisasi CBT** di Portal Data. Simpan Client ID dan Client Secret yang tampil satu kali sebagai `PORTAL_DATA_SYNC_CLIENT_ID` dan `PORTAL_DATA_SYNC_CLIENT_SECRET` di `.env` CBT. Portal menyimpan hash secret di database; tidak ada API key yang perlu disamakan antar-file `.env`.

## Portal Guru

- Login guru: `/guru`
- Dashboard guru: `/guru/dashboard`
- Guru masuk menggunakan NIP aktif hasil sinkronisasi Portal Data dan password credential CBT.
- Akun guru yang dibuat admin wajib menggunakan NIP sebagai username agar otomatis direlasikan dengan `teachers.id` lokal.
- Dashboard guru adalah view terpisah dari login, portal siswa, dan dashboard administrator.

## Keamanan dan runtime ujian

- Login siswa memakai NISN + PIN hash dan session server-side.
- Login pengelola memakai password hash; role berasal dari database/session.
- Request mutasi memerlukan `X-CSRF-Token`.
- `expires_at`, urutan soal/opsi, jawaban, ragu-ragu, pelanggaran, dan hasil berada di MySQL.
- Submit memakai transaction, row lock, dan unique result sehingga double submit idempotent.
- Jawaban benar tidak dikirim pada endpoint ruang ujian.
- Error teknis dicatat di `storage/logs/app.log` dan tidak ditampilkan saat `APP_DEBUG=false`.
- PIN diverifikasi melalui hash. Salinan PIN untuk kartu ujian dienkripsi AES-256-GCM menggunakan `APP_KEY` dan hanya dikembalikan oleh endpoint admin.
- Identitas siswa tidak dapat dibuat/dihapus atau dinaikkan kelas dari CBT; tindakan lama tersebut diarahkan ke sinkronisasi Portal Data.

## Shared hosting/cPanel

Jika document root tidak dapat diubah, taruh isi `public` di `public_html`, lalu ubah path `require` pada front controller agar menunjuk ke folder aplikasi di luar `public_html`. Jangan menaruh `.env`, `app`, `database`, atau `storage` privat di web root. HTTPS wajib untuk production dan `SESSION_SECURE_COOKIE=true`.

Dokumentasi integrasi Portal Data tersedia di [`docs/portal-data-integration.md`](docs/portal-data-integration.md). Runbook deployment lengkap tersedia di [`docs/deployment-shared-hosting.md`](docs/deployment-shared-hosting.md).

## Verifikasi

```bash
composer lint
composer test
```

Status test hanya boleh ditulis PASS setelah perintah benar-benar dijalankan. PHP 8.1 lokal dapat dipakai untuk lint awal, tetapi target deployment tetap PHP 8.2/8.3 sesuai `composer.json`.

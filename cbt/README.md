# CBT MAN 1 Palembang

Migrasi CBT dari Google Apps Script + Supabase ke PHP Native 8.2+, PDO, dan MySQL/MariaDB. `index.html` lama dipertahankan sebagai visual specification; `public/assets/js/legacy-bridge.js` menjembatani UI lama ke HTTP API PHP selama migrasi modul berlangsung.

## Kebutuhan

- PHP 8.2/8.3 dengan PDO MySQL, cURL, mbstring, fileinfo, zip, dan openssl
- MySQL 8 atau MariaDB yang mendukung JSON dan InnoDB
- Apache `mod_rewrite`; document root diarahkan ke folder `public`
- Composer 2 (dapat dijalankan lokal lalu folder `vendor` diunggah ke hosting)

## Instalasi

1. Salin `.env.example` ke `.env`, isi database serta credential API Portal Data.
2. Jalankan `composer install --no-dev --optimize-autoloader`.
3. Jalankan `composer migrate` atau import `database/schema.sql` lewat phpMyAdmin.
4. Pastikan `storage/logs`, `storage/cache`, dan `storage/imports` writable oleh PHP.
5. Arahkan document root domain/subdomain ke `cbt/public`.
6. Ambil CSRF dari `GET /api/auth/me`, lalu buat admin pertama satu kali lewat `POST /api/setup/admin` dengan `setup_token`, `username`, `name`, dan password minimal 12 karakter.
7. Setelah berhasil, kosongkan/hapus `SETUP_TOKEN` dari `.env`.

## Portal Data

CBT memanggil Portal Data hanya dari backend menggunakan bearer/API key. Contract default:

- `GET /api/v1/integration/cbt/students?page=1&per_page=100`
- `GET /api/v1/integration/cbt/teachers?page=1&per_page=100`
- `GET /api/v1/integration/cbt/classes?page=1&per_page=100`

Endpoint sync admin: `POST /api/admin/portal-data/sync/students`, `/teachers`, atau `/classes`. Sinkronisasi bersifat upsert berdasarkan ID Portal; NISN disimpan sebagai string. Saat Portal Data down, attempt aktif tetap memakai cache dan snapshot lokal CBT.

Portal Data harus mengisi `CBT_INTEGRATION_API_KEY` dengan nilai yang sama seperti `PORTAL_DATA_API_KEY` di CBT. Key hanya dikirim backend-to-backend melalui header dan tidak masuk ke aset browser.

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

Runbook lengkap untuk deployment Portal Data dan CBT tersedia di [`docs/deployment-shared-hosting.md`](docs/deployment-shared-hosting.md).

## Verifikasi

```bash
composer lint
composer test
```

Status test hanya boleh ditulis PASS setelah perintah benar-benar dijalankan. PHP 8.1 lokal dapat dipakai untuk lint awal, tetapi target deployment tetap PHP 8.2/8.3 sesuai `composer.json`.

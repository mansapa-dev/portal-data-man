# Arena — platform ujian mandiri

Arena adalah aplikasi di folder repo tersendiri dengan database dan deployment sendiri. CBT lama tetap berada di `cbt/`; Arena tidak menulis database CBT.

## Fitur yang sudah dimigrasikan ke tahap awal

- Siswa: login NISN/PIN bcrypt, daftar dan buka/lanjutkan ujian, snapshot soal dan opsi acak, autosave berversi/idempotent, flag ragu, heartbeat, pelanggaran (attempt diterminasi pada pelanggaran ketiga), submit/scoring termasuk cap nilai remedial, dan review status jawaban.
- Admin/staf: login password dan bootstrap admin satu kali, SSO Portal Data OIDC untuk guru/pegawai, dashboard admin/guru, daftar siswa/ujian/session, penugasan guru/piket, live session dan log pelanggaran.
- Operasional admin: sinkronisasi Portal Data per jenis dengan OAuth client credentials, pagination, upsert dan log status; impor soal dalam batch JSON (menerima nama field Arena atau field CBT Indonesia); reset batch hingga 50 siswa dalam request dengan transaksi dan audit terpisah per siswa.
- Layanan: tiket bantuan siswa/tamu dan petugas, komunikasi staf-admin berbasis thread, laporan hasil dan distribusi nilai per ujian.

Panel staf/admin sudah menyediakan daftar siswa dengan seleksi reset massal, editor ujian beserta jadwal dan target kelas/siswa, status sinkronisasi, impor soal JSON, penanganan tiket, percakapan staf-admin, tabel hasil, dan ringkasan distribusi nilai per ujian. Editor ujian menolak perubahan saat masih ada attempt berjalan. Ini belum mencakup seluruh formulir/editor seperti CBT. Belum ada migrasi data historis otomatis, gambar impor soal, pengelolaan PIN massal, jadwal susulan/kandidat remedial, ekspor Excel/PDF, pelampiran komunikasi, penonaktifan akun melalui rekonsiliasi penuh, job finalisasi attempt kedaluwarsa, dan pengujian kesetaraan semua aturan CBT. Karena itu Arena belum menggantikan CBT dan belum siap untuk peserta produksi.

## Jalankan lokal

Butuh Node.js 22+ dan MySQL 8/MariaDB. Buat database Arena baru; jangan arahkan ke database CBT.

```sh
cp .env.example .env
npm install
mysql -u root -p arena < database/migrations/001_core.sql
mysql -u root -p arena < database/migrations/002_staff_admin.sql
npm run dev
```

UI Vite berjalan pada port 5173 dan API pada port 3001. Konfigurasikan `DATABASE_URL`, `AUTH_TOKEN_SECRET` acak minimal 32 karakter, dan alamat/credential integrasi di `.env`.

Untuk membuat admin pertama, isi `SETUP_TOKEN`, panggil `POST /api/setup/admin` satu kali dengan `setup_token`, `username`, `name`, dan password minimal 12 karakter, lalu kosongkan `SETUP_TOKEN`. Daftarkan client OIDC dengan callback `https://<domain-arena>/auth/sso/callback` dan isi `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI`, serta `ARENA_WEB_URL`. Untuk sync, daftarkan OAuth client Portal Data dengan scope `portal_data.read` lalu isi `PORTAL_DATA_BASE_URL`, `PORTAL_DATA_SYNC_CLIENT_ID`, dan `PORTAL_DATA_SYNC_CLIENT_SECRET`.

Redis dipakai untuk rate limit lintas instance bila `REDIS_URL` tersedia. Health readiness melaporkan status DB dan Redis. Default pool Arena 20 koneksi dengan antrean terbatas; sesuaikan total pool seluruh instance dengan limit MySQL/VPS. Login password memakai hash bcrypt; kredensial dan token tidak boleh dicatat ke log.

## Kapasitas 1.300 peserta

Target 1.300 adalah peserta ujian bersamaan, bukan otomatis 1.300 request/detik. Kapasitas belum dibuktikan. Sebelum dipakai, tetapkan SLO p95/p99 dan error rate, lalu jalankan benchmark staging menyerupai VPS untuk pola login, baca soal, autosave, heartbeat, pelanggaran, admin, dan submit serentak. Catat event-loop delay, antrean HTTP/DB pool, koneksi, lock/commit MySQL, CPU, memori, dan I/O.

Arena menggunakan pool DB terbatas, payload kecil, index, debounce autosave 350 ms, jitter heartbeat, revision/idempotency, dan barrier row attempt agar submit serial dengan autosave. Submit menghitung scoring saat attempt dikunci; panjang critical section harus diukur dengan ukuran ujian nyata. Rate limit peserta berbasis identitas token agar satu NAT sekolah tidak berbagi kuota autosave; login dibatasi per akun. Hasil build bukan bukti lulus 1.300 pengguna.

## Migrasi aman

1. Validasi schema baru pada database staging kosong dan import data referensi dari Portal Data.
2. Cocokkan aturan CBT lama untuk eligibility, randomisasi, scoring, remedial, pelanggaran, reset, tiket, assignment, audit dan laporan.
3. Tambahkan tes fungsional/konkurensi di staging, termasuk save-submit race, retry, reset setelah pelanggaran ketiga, duplicate ticket, dan OIDC invalid token.
4. Jalankan beban bertahap sampai 1.300 peserta virtual; dokumentasikan konfigurasi dan hasil sebelum membuat klaim kapasitas.
5. Pilot terpisah dengan monitoring dan rollback; alihkan produksi hanya setelah seluruh fitur wajib serta hasil beban disetujui.

# Arena — platform ujian mandiri

Arena adalah aplikasi di folder repo tersendiri dengan database dan deployment sendiri. CBT lama tetap berada di `cbt/`; Arena tidak menulis database CBT.

## Fitur yang sudah dimigrasikan ke tahap awal

- Siswa: login NISN/PIN bcrypt, daftar dan buka/lanjutkan ujian, snapshot soal dan opsi acak, autosave berversi/idempotent, flag ragu, heartbeat, pelanggaran (attempt diterminasi pada pelanggaran ketiga), submit/scoring termasuk cap nilai remedial, dan review status jawaban.
- Admin/staf: login password dan bootstrap admin satu kali, SSO Portal Data OIDC untuk guru/pegawai, pengelolaan akun admin serta akun guru/pegawai yang terhubung ke personel tersinkron, dashboard admin/guru, daftar dan pencarian siswa/ujian/session, penugasan guru/piket, live session dan log pelanggaran.
- Operasional admin: sinkronisasi Portal Data per jenis dengan OAuth client credentials, pagination, upsert dan log status; penerbitan PIN acak untuk maksimal 25 siswa per batch (bcrypt di database, PIN hanya dikembalikan sekali dan tidak dicatat ke audit); impor soal dalam batch JSON (menerima nama field Arena atau field CBT Indonesia); reset batch hingga 50 siswa dalam request dengan transaksi dan audit terpisah per siswa.
- Layanan: tiket bantuan siswa/tamu dan petugas, komunikasi staf-admin berbasis thread, laporan hasil dan distribusi nilai per ujian, serta finalisasi attempt kedaluwarsa dengan scoring yang sama.

Panel staf/admin juga memiliki alur susulan dan remedial: susulan mengusulkan siswa aktif yang belum mengerjakan ujian sumber; remedial menampilkan attempt dengan sedikitnya tiga pelanggaran dan perlu persetujuan; pembuatan jadwal mengkloning soal serta penugasan guru secara batch. Jadwal harus setelah ujian sumber, selesai di tanggal WIB yang sama, dan jadwal aktif dalam periode memakai tanggal bersama. Batas nilai remedial X/XI/XII bisa disetel pada menu tersebut. Kandidat ditampilkan per ujian sumber (maksimal 1.000 baris per permintaan) agar halaman tidak memuat seluruh riwayat sekaligus.

Panel staf/admin juga menyediakan daftar siswa dengan pencarian dan seleksi reset/PIN massal, editor ujian beserta jadwal dan target kelas/siswa, manajemen akun, status sinkronisasi, impor soal JSON, penanganan tiket, percakapan staf-admin, tabel hasil, dan ringkasan distribusi nilai per ujian. PIN ditampilkan sekali pada respons dan harus dibagikan secara aman. Akun guru/pegawai terikat ke personel tersinkron; admin aktif terakhir dan akun sendiri tidak dapat dinonaktifkan, dan perubahan password lokal tidak mengubah kredensial SSO Portal Data. Editor ujian menolak perubahan saat masih ada attempt berjalan. Ini belum mencakup seluruh formulir/editor seperti CBT. Belum ada migrasi data historis otomatis, gambar impor soal, ekspor Excel/PDF, pelampiran komunikasi, penonaktifan akun melalui rekonsiliasi penuh, dan pengujian kesetaraan semua aturan CBT. Karena itu Arena belum menggantikan CBT dan belum siap untuk peserta produksi.

### Bank soal, pemantauan, dan tampilan peserta

- Admin dapat menambah, mengubah, menghapus, dan mempratinjau soal; mengimpor/mengekspor CSV yang dapat dibuka di Excel; serta mengunggah gambar soal PNG/JPEG/WebP/GIF maksimal 2 MB. Gambar disimpan sebagai berkas dan dikirim ke peserta lewat URL dengan cache panjang, bukan sebagai base64 di setiap respons ujian. Set `ARENA_UPLOAD_DIR` ke direktori persisten yang dibackup bersama database saat deployment.
- Impor CSV memeriksa baris di browser sebelum dikirim. API memproses impor dalam batch kecil; gambar yang tertanam di XLSX lama belum otomatis ikut terimpor. Untuk migrasi soal bergambar, unggah gambarnya lewat editor setelah impor CSV.
- Panel guru/pengawas menampilkan ujian, hasil per ujian, sesi aktif, dan pelanggaran; admin dapat mengelola penugasan dan kelayakan pengawas. Sesi, pelanggaran, dan hasil dibatasi 100 baris per halaman. Pemantauan memperbarui setiap 45 detik hanya ketika tab terbuka.
- Waktu ujian dihitung mundur di browser dengan acuan waktu server, tanpa request per detik. Saat habis, klien meminta finalisasi; finalizer API tetap menangani peserta yang putus koneksi. Pelanggaran dikirim hanya saat browser mengamati pindah tab, salin, shortcut tangkapan layar, keluar mode layar penuh, atau viewport mobile yang sangat menyempit. Browser tidak dapat mendeteksi tangkapan layar dari luar halaman.

## Jalankan lokal

Butuh Node.js 22+ dan MySQL 8/MariaDB. Buat database Arena baru; jangan arahkan ke database CBT.

```sh
cp .env.example .env
npm install
mysql -u root -p arena < database/migrations/001_core.sql
mysql -u root -p arena < database/migrations/002_staff_admin.sql
mysql -u root -p arena < database/migrations/003_exam_retake_candidates.sql
npm run dev
```

UI Vite berjalan pada port 5173 dan API pada port 3001. Konfigurasikan `DATABASE_URL`, `AUTH_TOKEN_SECRET` acak minimal 32 karakter, dan alamat/credential integrasi di `.env`.

Untuk membuat admin pertama, isi `SETUP_TOKEN`, panggil `POST /api/setup/admin` satu kali dengan `setup_token`, `username`, `name`, dan password minimal 12 karakter, lalu kosongkan `SETUP_TOKEN`. Daftarkan client OIDC dengan callback `https://<domain-arena>/auth/sso/callback` dan isi `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI`, serta `ARENA_WEB_URL`. Untuk sync, daftarkan OAuth client Portal Data dengan scope `portal_data.read` lalu isi `PORTAL_DATA_BASE_URL`, `PORTAL_DATA_SYNC_CLIENT_ID`, dan `PORTAL_DATA_SYNC_CLIENT_SECRET`.

Redis dipakai untuk rate limit lintas instance bila `REDIS_URL` tersedia. Health readiness melaporkan status DB dan Redis. Default pool Arena 20 koneksi dengan antrean terbatas; sesuaikan total pool seluruh instance dengan limit MySQL/VPS. Finalizer berjalan otomatis pada tiap instance API, tetapi MySQL advisory lock memastikan hanya satu instance memproses batch pada satu waktu. Default interval 30 detik dan ukuran batch 25 (`ATTEMPT_FINALIZER_INTERVAL_MS`, `ATTEMPT_FINALIZER_BATCH_SIZE`); set `ATTEMPT_FINALIZER_ENABLED=false` untuk menonaktifkannya. Login password memakai hash bcrypt; kredensial dan token tidak boleh dicatat ke log.

## Kapasitas 1.300 peserta

Target 1.300 adalah peserta ujian bersamaan, bukan otomatis 1.300 request/detik. Kapasitas belum dibuktikan. Sebelum dipakai, tetapkan SLO p95/p99 dan error rate, lalu jalankan benchmark staging menyerupai VPS untuk pola login, baca soal, autosave, heartbeat, pelanggaran, admin, dan submit serentak. Catat event-loop delay, antrean HTTP/DB pool, koneksi, lock/commit MySQL, CPU, memori, dan I/O.

Arena menggunakan pool DB terbatas, payload kecil, index, debounce autosave 350 ms, jitter heartbeat, revision/idempotency, dan barrier row attempt agar submit serial dengan autosave. Submit dan finalisasi kedaluwarsa menghitung scoring saat attempt dikunci; panjang critical section harus diukur dengan ukuran ujian nyata. Rate limit peserta berbasis identitas token agar satu NAT sekolah tidak berbagi kuota autosave; login dibatasi per akun. Hasil build bukan bukti lulus 1.300 pengguna.

## Migrasi aman

1. Validasi schema baru pada database staging kosong dan import data referensi dari Portal Data.
2. Cocokkan aturan CBT lama untuk eligibility, randomisasi, scoring, remedial, pelanggaran, reset, tiket, assignment, audit dan laporan.
3. Tambahkan tes fungsional/konkurensi di staging, termasuk save-submit race, retry, reset setelah pelanggaran ketiga, duplicate ticket, dan OIDC invalid token.
4. Jalankan beban bertahap sampai 1.300 peserta virtual; dokumentasikan konfigurasi dan hasil sebelum membuat klaim kapasitas.
5. Pilot terpisah dengan monitoring dan rollback; alihkan produksi hanya setelah seluruh fitur wajib serta hasil beban disetujui.

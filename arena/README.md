# Arena — platform ujian MAN 1 Palembang

Arena adalah aplikasi baru dengan API Fastify/TypeScript, UI React/Vite, dan database sendiri. CBT lama tetap berada di `../cbt`; Arena tidak memakai atau menulis database CBT. Implementasi Arena dibuat pada struktur dan kontrak Arena, bukan dengan menyalin source code CBT.

Dokumen ini membandingkan fitur Arena dengan source dan dokumentasi CBT yang ada di repository. Status `Tersedia` berarti ada implementasi yang ditemukan, bukan jaminan sudah lulus verifikasi produksi. Kapasitas dan kesetaraan perilaku harus dibuktikan lewat pengujian.

## Ringkasan fitur

| Area | Arena | Referensi CBT / catatan |
|---|---|---|
| Login siswa | NISN + PIN yang diverifikasi dengan bcrypt; sesi dapat dipulihkan setelah refresh | CBT juga memakai NISN/PIN dan sesi server |
| Login staf | Password lokal untuk admin; guru/pegawai melalui OIDC Portal Data | CBT mendukung akun staf dan SSO Portal Data; alur kredensial lokal berbeda |
| Sinkronisasi akademik | Portal Data OAuth, pagination, upsert, log, penguncian per jenis, revision check sebelum rekonsiliasi, dan penonaktifan record yang hilang hanya setelah sync lengkap dan stabil | CBT memiliki sync dan rekonsiliasi serupa |
| Ujian siswa | Daftar, mulai/lanjutkan, timer berbasis waktu server, snapshot urutan soal/opsi, autosave berversi dan idempotent, tandai ragu, heartbeat, submit, hasil dan review | Fitur inti CBT tersedia; aturan detail masih perlu uji kesetaraan |
| Integritas ujian | Mencatat pindah tab, salin/tempel/potong, menu konteks, shortcut screenshot/DevTools/browser, keluar fullscreen, dan dugaan split-screen; metadata waktu klien, IP, dan user-agent disimpan untuk peninjauan | CBT juga mengamati sebagian sinyal ini. Semuanya indikator browser, bukan bukti pasti kecurangan |
| Admin dan guru | Dashboard, akun, siswa, ujian, penugasan guru/pengawas, sesi langsung, pelanggaran, tiket bantuan, bank soal, hasil dan laporan | Sebagian besar alur panel CBT tersedia di Arena |
| Susulan dan remedial | Kandidat, persetujuan dan pembuatan jadwal lanjutan; soal dan assignment sumber disalin; cap nilai remedial dapat diatur | CBT memiliki alur sejenis; aturan sekolah wajib dicocokkan |
| Bank soal | CRUD dan pratinjau; impor XLSX/XLS/ODS dan DOCX; ekspor XLSX; unggah gambar dan dukungan gambar/persamaan tertanam pada XLSX | CBT memiliki editor/impor spreadsheet. Format file nyata tetap perlu diuji bersama |
| Hasil | Tabel hasil dan distribusi; ekspor XLSX; cetak laporan melalui browser dan opsi “Simpan sebagai PDF” | PDF tersedia sebagai alur cetak browser, bukan generator PDF server |
| Kartu peserta | PIN tampil di kontrol siswa; PIN tersimpan terenkripsi untuk kartu cetak/ekspor admin | Format kartu Arena kini memuat nomor peserta, nama, kelas/tingkat, dan PIN seperti kartu CBT |
| Bantuan peserta | Tiket bantuan siswa/tamu dan panel penanganan petugas, termasuk alur reset yang diaudit | Tiket bantuan tersedia di CBT |
| Android peserta | Prototipe WebView Arena baru di `android-app/`; secure window dan pembatasan navigasi host | CBT memiliki prototipe Android sendiri. APK Arena belum dibangun atau diuji perangkat |
| Percakapan staf/admin | **Dihapus dan tidak digunakan** | Fitur chat CBT sengaja tidak dimasukkan ke Arena sesuai keputusan produk |

## Belum tersedia atau belum dibuktikan

- **Migrasi data historis otomatis dari CBT belum tersedia.** Perlu sumber ekspor yang disetujui, pemetaan skema, kebijakan untuk attempt yang sedang berjalan, dan rekonsiliasi hasil sebelum alat migrasi dibuat. Jangan mengimpor langsung ke database produksi.
- **Kesetaraan seluruh aturan CBT belum dibuktikan.** Prioritas pencocokan: eligibility, randomisasi, scoring, remedial/susulan, reset, penanganan pelanggaran, tiket, assignment, audit, dan laporan.
- **Aplikasi Android Arena masih prototipe sumber.** Belum ada APK bertanda tangan, distribusi, pengujian perangkat nyata, atau kebijakan agar peserta tidak beralih ke browser biasa. WebView juga memerlukan konfigurasi HTTPS origin saat build.
- **Kapasitas ujian belum terukur.** Target 1.200/1.300 peserta bukan klaim kapasitas sampai alur end-to-end diuji pada staging yang menyerupai server tujuan.
- **PDF adalah fitur cetak browser.** Browser peserta/admin harus memilih “Simpan sebagai PDF”; Arena belum menghasilkan berkas PDF langsung dari server.

## Keamanan dan sinkronisasi

PIN login disimpan sebagai bcrypt hash dan salinan untuk cetak ulang disimpan dengan enkripsi AES-256-GCM. PIN hanya dapat dibuka oleh admin melalui endpoint tanpa cache; aksesnya diaudit. Token, password, dan PIN tidak boleh ditulis ke log. Sinkronisasi Portal Data berjalan dari backend dengan OAuth client credentials, halaman diproses bertahap, dan jenis yang sama tidak boleh berjalan bersamaan. Arena hanya merekonsiliasi record yang tidak ditemukan setelah seluruh halaman sukses dan checksum Portal Data tidak berubah selama sinkronisasi. Jika endpoint revision gagal atau checksum berubah, proses gagal tanpa penonaktifan massal.

Record siswa yang tidak lagi ditemukan dinonaktifkan untuk login/eligibility; guru, pegawai, kelas, tahun ajaran, atau semester ditandai tidak aktif sesuai hasil sinkronisasi. Riwayat ujian tidak dihapus oleh rekonsiliasi. Perubahan ini memerlukan migration aplikasi biasa untuk struktur chat lama, tetapi tidak membutuhkan perubahan skema untuk rekonsiliasi.

## Menjalankan Arena secara lokal

Butuh Node.js 22+ dan MySQL 8 atau MariaDB. Gunakan database Arena baru; jangan arahkan konfigurasi ke database CBT atau Portal Data.

```sh
cp .env.example .env
npm install
mysql -u root -p arena < database/migrations/001_core.sql
mysql -u root -p arena < database/migrations/002_staff_admin.sql
mysql -u root -p arena < database/migrations/003_exam_retake_candidates.sql
mysql -u root -p arena < database/migrations/004_exam_lookup_indexes.sql
mysql -u root -p arena < database/migrations/005_remove_staff_admin_communications.sql
mysql -u root -p arena < database/migrations/006_exam_integrity_signals.sql
mysql -u root -p arena < database/migrations/007_student_pin_ciphertext.sql
mysql -u root -p arena < database/migrations/008_perf_indexes.sql
mysql -u root -p arena < database/migrations/009_violation_threshold.sql
mysql -u root -p arena < database/migrations/010_violation_anti_copy.sql
npm run dev
```

Migrasi `005` menghapus tabel percakapan staf/admin Arena yang lama beserta isinya. Tiket bantuan tidak dihapus. Untuk demo lokal terisolasi, gunakan `npm run local:setup` lalu `npm run dev`; database demo hanya terikat ke localhost port 3308 dan tidak memakai database CBT/Portal Data.

Jika database demo sudah ada, jalankan `npm run local:setup` untuk menerapkan migrasi `006` dan `007` yang idempotent sebelum menjalankan ulang aplikasi. Hindari menjalankan ulang `npm run demo:migrate` pada database berisi data karena perintah tersebut ditujukan untuk database baru. Atur `PIN_ENCRYPTION_KEY` sebagai secret acak yang berbeda dari `AUTH_TOKEN_SECRET`, dan simpan backup key dengan aman; PIN kartu tidak dapat dibuka jika key hilang atau diganti.

### Batas deteksi dan prosedur pengawasan

Halaman web hanya dapat mengirim sinyal yang tersedia melalui API browser. Arena tidak dapat memastikan apakah siswa memakai ponsel/perangkat kedua, menerima bantuan orang lain, memakai kamera atau aplikasi jarak jauh, mengambil screenshot melalui OS/perangkat lain, atau membuka DevTools dengan cara yang tidak menghasilkan event keyboard. Sinyal pindah tab, hilang fokus (pindah jendela/aplikasi lain), keluar fullscreen, screenshot shortcut, salin, tab/kartu ujian kedua pada perangkat yang sama (deteksi BroadcastChannel antar-tab), dan dugaan split-screen masuk ke hitungan pelanggaran; semua tipe tersebut dihitung menuju terminasi otomatis. Tempel/potong, menu konteks, dan shortcut DevTools/browser direkam untuk peninjauan tanpa menghitung terminasi. Pada perangkat mobile/iOS: seleksi teks dan long-press diblokir via CSS antiseleksi plus sinyal `TEXT_SELECTION`, pinch-zoom diblokir, dan halaman menutup overscroll/pull-to-refresh. Batas terminasi otomatis dapat diatur admin ke 2 atau 3 pelanggaran terhitung melalui `POST /api/admin/settings/violation-threshold` (default 3, pengaturan `cbt_settings.violation_termination_threshold`), kebijakan setelah terminasi dapat diatur ke `AUTO_SUBMIT` (finalisasi nilai otomatis) atau `LOCK` (kunci tanpa nilai, reset admin) melalui `POST /api/admin/settings/violation-action`. Seleksi teks soal / long-press (Google Search panel) diblokir via CSS antiseleksi plus sinyal `TEXT_SELECTION` yang seluruhnya dihitung di server; tiga sinyal serupa (mis. seleksi teks atau menu konteks) di-roll-up menjadi satu pelanggaran terhitung (kolom `violations.rolled_up`), dan tiap sinyal menyimpan nomor soal saat kejadian untuk tinjauan pengawas. Jangan jadikan satu event sebagai bukti pelanggaran akademik.

Untuk ujian berpengawasan, sekolah/panitia perlu menetapkan dan mengumumkan prosedur sebelum ujian: verifikasi identitas dan perangkat; tata letak tempat duduk serta jarak pandang yang memungkinkan pengawas melihat layar; larangan perangkat tambahan, earphone, komunikasi, dan materi yang tidak diizinkan; instruksi untuk tetap pada halaman ujian dan meminta bantuan pengawas bila terjadi gangguan; serta pencatatan insiden oleh pengawas dengan waktu, peserta, konteks, dan saksi. Tinjau riwayat sinyal bersama catatan pengawas sebelum mengambil tindakan. Rasio pengawas, pemeriksaan perangkat, dan konsekuensi pelanggaran harus ditetapkan sekolah, bukan diasumsikan oleh aplikasi.

IP, user-agent, dan waktu dari klien adalah metadata yang dapat tidak akurat atau dipalsukan. Batasi akses metadata ke administrator, tentukan masa retensinya, dan jangan gunakan sebagai satu-satunya dasar sanksi. Layar penuh dan pemblokiran shortcut bergantung pada kemampuan browser/perangkat dan dapat dilewati; perangkat ujian terkunci atau aplikasi kiosk terkelola memerlukan kebijakan serta pengujian perangkat tersendiri.

API berjalan pada port 3001 dan Vite pada port 5173. Atur `DATABASE_URL`, `AUTH_TOKEN_SECRET` acak minimal 32 karakter, serta credential OIDC/Portal Data sesuai kebutuhan. Untuk gambar bank soal, atur `ARENA_UPLOAD_DIR` ke direktori persisten yang dibackup bersama database.

## Prototipe Android Arena

Sumber aplikasi ada di [`android-app/`](android-app/README.md). Bangun hanya setelah HTTPS origin Arena diketahui dan disetujui:

```sh
cd android-app
gradle assembleDebug -PARENA_BASE_URL=https://arena.example.school
```

Ganti contoh origin dengan domain resmi. Jangan mendistribusikan APK debug sebagai aplikasi ujian resmi. Pengujian dan signing rilis belum dilakukan.

## Kapasitas dan kesiapan produksi

Arena belum dinyatakan siap menggantikan CBT dan belum memiliki klaim kapasitas peserta. Sebelum pilot, verifikasi konfigurasi database dan server staging, uji workflow siswa/staf secara end-to-end, uji sinkronisasi/reconciliation, uji pemulihan koneksi dan konkurensi submit, lalu jalankan load test bertahap. Catat SLO p95/p99, error, durabilitas jawaban yang sudah diakui, antrean pool, lock MySQL, CPU, memori, dan event-loop delay.

Panduan rilis staging ke VPS untuk `staging.arena.man1palembang.sch.id` ada di [docs/deployment/staging-vps.md](docs/deployment/staging-vps.md). Dokumen tersebut adalah prosedur persiapan; domain, DNS, MySQL server, Portal Data, Nginx, dan VPS belum diverifikasi atau diubah.

# Perbaikan ujian massal — 7 September 2026

Pembaruan 8 September: lihat [reset CBT, sinkronisasi otomatis, dan uji 1.300 peserta](reset-sync-capacity.md). Ketentuan reset di bawah adalah catatan versi sebelumnya.

## Perubahan

- Jawaban dan tanda ragu masuk antrean localStorage per public ID attempt, sebelum UI menganggapnya tersimpan di perangkat. Pengiriman berurutan, retry otomatis, dan status membedakan antrean perangkat dari konfirmasi server. Web Locks membatasi satu tab pengedit pada browser yang sama. Gunakan browser modern melalui HTTPS (localhost dapat dipakai untuk pengujian).
- Server memeriksa expected revision dan mutation ID per soal. Retry respons yang hilang tidak menggandakan perubahan; request lama/perangkat lain tidak boleh diam-diam menimpa jawaban. Konflik menghentikan antrean dan memerlukan pemeriksaan pengawas. Jangan menghapus data browser saat ada antrean tertunda.
- Submit manual menunggu antrean kosong. Kegagalan tidak menghentikan pengerjaan sebelum waktunya. Saat deadline/terminasi, hanya jawaban yang sudah diterima server dinilai; antrean yang belum diterima tetap disimpan untuk pemeriksaan, bukan dimasukkan terlambat ke nilai.
- Hasil dapat dipulihkan melalui start setelah submit berhasil tetapi respons terputus. Riwayat attempt tetap terlihat setelah jadwal berakhir.
- `finalize-exams.php` menyelesaikan attempt IN_PROGRESS kedaluwarsa dan TERMINATED tanpa hasil. Eksekusi berulang aman karena row lock dan unique result. Reset EXPIRED lama tidak otomatis dibuka/dinilai ulang.
- Pembatasan login per akun; submit/pelanggaran per siswa dan ujian. Batas jaringan bersama tetap tersedia melalui LOGIN_IP_LIMIT (default 2000 request login / 300 detik). Sesuaikan dengan jumlah peserta dan infrastruktur.
- Isi, opsi, kunci, dan poin dibekukan per attempt. Resume, penyimpanan, penilaian, review, dan progres monitoring menggunakan snapshot. Transaksi memiliki retry terbatas untuk deadlock/lock timeout.
- Review ditutup secara default. Admin dapat menerbitkan/menutupnya dari daftar ujian setelah jadwal berakhir. Admin wajib memastikan seluruh sesi dan ujian lain yang memakai soal sama telah selesai; sistem belum mengidentifikasi kesamaan soal lintas ujian.
- Konten soal dibersihkan dengan allowlist HTML. Gambar yang diizinkan adalah path lokal dan data URI PNG/JPEG/GIF/WebP; URL eksternal tidak didukung oleh kebijakan gambar saat ini. Konten lama juga dibersihkan saat dikirim ke siswa/admin.
- Monitoring guru dibatasi penugasan dan menampilkan heartbeat. ONLINE berarti heartbeat diterima dalam 90 detik, bukan jaminan siswa sedang melihat layar. Heartbeat dikirim sekitar 30 detik, hanya ketika ruang ujian aktif.
- Reset seluruh ujian siswa dinonaktifkan. Tombol tindak lanjut menuju jadwal ujian ulang; gangguan koneksi menggunakan resume attempt yang sama. Fitur penambahan waktu manual belum ditambahkan.
- Endpoint terlindungi memeriksa status akun terkini. Error internal API disembunyikan saat APP_DEBUG=false.

## Penerapan pada instalasi yang sudah ada

1. Lakukan pada jendela pemeliharaan tanpa ujian berjalan. Backup database dan uji pemulihannya lebih dahulu.
2. Pastikan PHP 8.2/8.3, PDO MySQL, DOM, OpenSSL, cURL, dan konfigurasi `.env` tersedia. Kode diuji lokal dengan PHP 8.1.10; verifikasi target runtime tetap diperlukan.
3. Upload kode dan jalankan `php scripts/upgrade-mass-exam.php` dari direktori `cbt`. Perintah ini hanya menerapkan tiga migrasi baru yang idempotent, tanpa mengulang migrasi legacy lainnya.
4. Snapshot attempt lama hanya dapat diisi dari soal yang tersedia saat migrasi. Migrasi tidak dapat merekonstruksi isi/kunci historis yang sudah pernah diedit. Tinjau attempt lama yang belum selesai sebelum membuka trafik.
5. Pasang cron setiap menit: `* * * * * /path/to/php /path/to/cbt/scripts/finalize-exams.php 200`. Pantau output `failed`, log PHP CLI, dan jumlah attempt kedaluwarsa tanpa hasil. Besar batch perlu disesuaikan setelah uji beban; 200/menit bukan kapasitas yang dijamin.
6. Muat ulang browser peserta sebelum ujian baru; frontend dan backend versi lama tidak kompatibel dengan protokol revisi baru. Pastikan localStorage dan Web Locks tersedia di perangkat peserta.
7. Jalankan simulasi browser, jaringan sekolah, dan server produksi/staging sebelum menetapkan jumlah peserta. Integrasi Portal Data/SSO tidak diubah atau diverifikasi langsung pada pekerjaan ini.

Instalasi baru: schema.sql sudah mencakup tabel baru. Jangan menaruh folder aplikasi privat atau database uji di web root; document root tetap `public`.

## Verifikasi yang dijalankan

- Test bawaan: 16 lulus, termasuk monitoring guru yang sebelumnya gagal.
- Antrean JavaScript: 7 skenario perilaku (offline/refresh, urutan perubahan cepat, response hilang, pemulihan acknowledgement, konflik, storage penuh, stop dengan write berjalan).
- Integrasi MySQL 8.0.30 terisolasi: 26 pemeriksaan lulus. Database dibuat acak pada port 13317 lalu dihapus oleh test; tidak membaca .env produksi.
- Simulasi HTTP: 50 siswa bersamaan, 850 request melalui empat proses PHP lokal, 50 selesai/0 gagal, 50 attempt dan 50 hasil. Durasi 9,053 detik; p95 request 1,069 detik; maksimum 1,627 detik. Ini simulasi alur lokal, bukan patokan kapasitas produksi.
- Ada percobaan awal klien fetch Node 18.8 eksperimental yang gagal membaca respons; klien uji diganti ke node:http. Satu percobaan berikutnya mengalami timeout, kemudian fixture dibangun ulang: simulasi 10 siswa dan 50 siswa lulus. Penyebab timeout tersebut belum dipastikan; hasil ini tidak cukup untuk menyatakan kesiapan produksi.
- Belum diuji secara visual di browser, pada PHP target 8.2/8.3, atau dengan kondisi jaringan sekolah nyata.

Perintah pengujian: `php tests/run.php`, `node tests/answer-queue.test.cjs`, dan `php tests/exam-integrity.php` (yang terakhir memerlukan CBT_TEST_ISOLATED=1 serta MySQL terisolasi pada 127.0.0.1:13317). Fixture HTTP hanya boleh dijalankan terhadap server lokal terisolasi; empat worker pada port 18471–18474 harus menggunakan database `cbt_http_mass_test` dan session.save_path writable.

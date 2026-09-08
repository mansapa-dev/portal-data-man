# Reset CBT, sinkronisasi otomatis, dan sesi 1.300 peserta

## Perilaku aplikasi

- Admin membuka **Log Pelanggaran → Reset CBT**, memilih attempt melalui baris ujian, lalu mengisi alasan. Tombol di Data Siswa mengarahkan ke log ini. Endpoint memerlukan sesi ADMIN aktif dan CSRF; layanan juga memeriksa ulang peran admin.
- Hanya attempt TERMINATED dengan minimal tiga pelanggaran yang dibuka. Jawaban, revisi penyimpanan, tanda ragu, snapshot soal, dan urutan opsi dipertahankan. Hitungan pelanggaran kembali nol. Catatan pelanggaran lama dan nilai terkunci sebelum reset disimpan dalam audit. Reset berulang terhadap attempt yang sudah dibuka ditolak.
- Sisa waktu dihitung dari saat pelanggaran terakhir, lalu dipulihkan hingga maksimal akhir jadwal ujian. Jadwal dan siswa harus masih aktif. Reset tidak memberikan durasi ujian baru dan tidak membuka jadwal yang sudah berakhir. Proses penilaian otomatis yang terlambat tidak boleh menutup kembali attempt yang sudah direset.
- Siswa kembali ke Dashboard Ujian, kemudian klik **Lanjutkan**. Dashboard diperbarui sekitar 15–25 detik ketika terlihat; tidak melakukan polling daftar ujian saat mengerjakan soal. Seluruh ujian relevan bagi tingkat/target kelas tetap tampil, termasuk yang akan datang dan yang sudah selesai. Tombol ujian selesai, terblokir, belum waktunya, atau tidak ditargetkan dinonaktifkan.
- Jadwal susulan/ulang harus mulai dan selesai pada satu tanggal WIB, setelah jadwal asal berakhir. Aturan berlaku pada pembuatan dan penyuntingan jadwal. Seluruh jadwal susulan/ulang aktif yang belum berakhir dalam tahun ajaran dan semester yang sama memakai satu tanggal bersama. Jadwal aktif pertama menentukan tanggal tersebut; pembuatan, penyuntingan, dan pengaktifan jadwal lain wajib mengikuti tanggal itu. Setelah semua jadwal periode susulan tersebut berakhir, batch berikutnya dapat memakai tanggal baru. Draft nonaktif dapat disiapkan, tetapi diperiksa lagi saat diaktifkan. Jika jadwal lama terlanjur berbeda tanggal, nonaktifkan jadwal yang perlu diubah, samakan tanggalnya, lalu aktifkan kembali.
- Siswa nonaktif tidak diimpor sebagai peserta baru dan tidak tampil di daftar/kartu peserta. Data yang sudah memiliki riwayat dinonaktifkan, bukan dihapus. Guru yang dinonaktifkan kehilangan akses pada permintaan terlindungi berikutnya setelah sinkronisasi.

## Mengaktifkan sinkronisasi

Deploy perubahan Laravel Portal Data terlebih dahulu. Endpoint `GET /api/v1/integration/cbt/revisions` menggunakan service token yang sama dengan endpoint referensi lainnya. Revisi mendeteksi perubahan field referensi, perubahan kelas, impor yang melewati observer, soft delete, dan penghapusan fisik. Tidak mengirim identitas siswa dalam respons revisi.

Pada CBT, gunakan kredensial `PORTAL_DATA_SYNC_CLIENT_ID` dan `PORTAL_DATA_SYNC_CLIENT_SECRET` yang sudah ada di `.env`, lalu jalankan:

```sh
php scripts/sync-portal.php --once
php scripts/sync-portal.php
```

Worker memeriksa revisi setiap `PORTAL_DATA_SYNC_INTERVAL=5` detik, hanya menarik jenis data yang berubah, dan melakukan rekonsiliasi penuh setiap lima menit. Ini sinkronisasi mendekati real-time melalui polling; latensi juga mencakup waktu mengambil halaman data. Worker tidak bergantung pada dashboard admin dan tidak dijalankan oleh browser peserta. Revisi diperiksa kembali sebelum menonaktifkan data yang tidak ditemukan agar perubahan saat pagination tidak salah mencabut akses peserta. Gangguan Portal memicu retry dengan jeda maksimum 60 detik; kegagalan sinkronisasi tidak menonaktifkan semua peserta yang belum terambil.

Untuk proses yang bertahan setelah logout/reboot, sesuaikan akun/path dalam `deploy/cbt-portal-sync.service`, pasang sebagai systemd service di server, lalu aktifkan melalui administrator server. Worker dan sinkronisasi manual menggunakan lock database untuk mencegah proses sejenis bertumpuk. Pantau journal service serta `/api/admin/portal-data/sync/status`. Bila hosting hanya mendukung cron, jalankan `--once` setiap menit; latensinya menjadi sekitar satu menit.

Tidak ada migrasi database baru untuk fitur ini; tabel audit dan snapshot menggunakan schema CBT yang sudah ada. Instalasi lama tetap harus sudah menerapkan upgrade mass-exam sebelumnya. Upload aset dengan versi terbaru dan muat ulang browser. Worker belum dipasang di server produksi oleh perubahan kode ini.

## Kapasitas dan pengujian

Perubahan menghapus query attempt per kartu dashboard dan membatch insert snapshot soal saat mulai ujian. Antrean jawaban, pemeriksaan revisi, retry idempotent, dan row lock tetap digunakan. Data Portal diperiksa oleh satu worker, bukan 1.300 klien. Semua ini membantu kapasitas, tetapi tidak menetapkan kapasitas server produksi secara otomatis.

Simulasi HTTP menggunakan database terisolasi pada localhost port 13317, empat proses PHP, 1.300 akun, dan 40 soal. Semua siswa yang berhasil mulai ditahan pada barrier sebelum menjawab sehingga sesi mereka aktif bersamaan. Setiap jawaban dikirim ulang dengan mutation ID sama untuk memeriksa idempotensi; submit dilakukan dua kali, kemudian pemulihan hasil dan status dashboard diperiksa.

```sh
php tests/run.php
node tests/answer-queue.test.cjs
node tests/student-dashboard.test.cjs
CBT_TEST_ISOLATED=1 php tests/exam-integrity.php
CBT_TEST_ISOLATED=1 CBT_TEST_STUDENTS=1300 CBT_TEST_QUESTIONS=40 python3 tests/run-http-mass.py
```

Runner hanya menghubungi localhost. MySQL/MariaDB uji harus terpisah dari database aplikasi, menggunakan port 13317 dan akun root tanpa password khusus fixture. Database fixture tidak ditimpa bila sudah ada; database serta proses HTTP dibersihkan setelah simulasi. `CBT_TEST_WORKERS` dapat diubah dari 1 hingga 32 untuk membandingkan jumlah worker. Pengujian ini tidak mengirim data ke Portal Data produksi.

Sebelum sesi nyata, jalankan uji pada staging dengan PHP-FPM/OPcache, database, jumlah soal/gambar, kebijakan hash PIN, dan jaringan yang sama dengan produksi. Pantau p95 tiap endpoint, error/timeout, antrean PHP-FPM, CPU/RAM, koneksi database, dan jumlah hasil unik. Browser menunggu maksimal 120 detik untuk login/mulai, 60 detik untuk submit, dan 15 detik untuk request lainnya. Timeout lebih panjang mencegah kegagalan semu saat antrean padat, tetapi tidak mempercepat autentikasi. Targetkan login peserta sebelum jam mulai dan ukur lagi lonjakan login di server tujuan. Jangan menggunakan server bawaan `php -S` untuk produksi. Pertahankan penilaian server berkala melalui `scripts/finalize-exams.php`; sesuaikan batch agar seluruh peserta kedaluwarsa diproses.

### Hasil lokal 8 September 2026

- PHP 8.3.6, MariaDB 10.11.14, empat proses PHP CLI tanpa OPcache.
- 1.300 peserta × 40 soal, 115.700 request: **1.300 selesai, 0 gagal**, durasi 587,377 detik.
- p95 seluruh request 8,584 detik; maksimum 69,443 detik.
- p95 per endpoint: login 65,122 detik; start/pemulihan 62,315 detik; daftar ujian 5,596 detik; heartbeat 6,264 detik; jawaban 7,585 detik; submit 17,971 detik.
- Hasil tersebut membuktikan integritas pada simulasi ini. Lonjakan login masih lambat pada mesin lokal; bukan jaminan performa produksi atau latensi rendah. Timeout browser untuk operasi tersebut disesuaikan setelah temuan ini.
- Tes tambahan: 22 pemeriksaan bawaan CBT, 7 skenario antrean jawaban, 2 skenario dashboard, 63 pemeriksaan integrasi database, dan 7 tes Laravel Portal Data (28 assertion). Pengujian browser visual, data/gambar produksi, gangguan jaringan sekolah, dan service Portal/SSO langsung belum dilakukan.

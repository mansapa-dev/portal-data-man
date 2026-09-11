# Tiket bantuan CBT

Siswa dapat mengirim tiket dari halaman login, dashboard, ruang ujian, atau halaman hasil ketika ujian dihentikan. Permintaan ini tidak mengakhiri sesi siswa dan tidak menghapus jawaban.

Admin melihat semua tiket pada menu **Tiket Bantuan**. Penugasan memiliki jenis **Guru Mata Pelajaran** atau **Petugas Piket Ujian**. Guru mapel tidak menerima tiket. Hanya petugas piket yang ditugaskan pada ujian terkait yang dapat melihat, mengambil, memberi catatan, menyelesaikan tiket, dan mereset CBT siswa. Tiket akun tanpa ujian tertentu masuk ke petugas piket yang bertugas pada hari tersebut. Admin tetap memiliki akses cadangan.

Panel petugas dan status tiket siswa diperbarui setiap 10 detik saat sedang dibuka. Setelah petugas piket memilih **Reset CBT & selesaikan**, attempt kembali menjadi `IN_PROGRESS`, hitungan pelanggaran menjadi nol, dan jawaban sebelumnya tetap tersedia.

Saat deploy, jalankan:

```bash
php database/migrate.php
```

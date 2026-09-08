# Tiket bantuan CBT

Siswa dapat mengirim tiket dari halaman login, dashboard, ruang ujian, atau halaman hasil ketika ujian dihentikan. Permintaan ini tidak mengakhiri sesi siswa dan tidak menghapus jawaban.

Admin melihat semua tiket pada menu **Tiket Bantuan**. Guru atau guru piket hanya melihat tiket yang terkait dengan ujian pada menu **Penugasan Guru / Piket**. Guru dapat mengambil tiket, memberi catatan, dan menandai kendala selesai. Reset ujian yang dihentikan karena tiga pelanggaran tetap hanya tersedia untuk admin.

Panel petugas dan status tiket siswa diperbarui setiap 10 detik saat sedang dibuka. Setelah admin memilih **Reset CBT & selesaikan**, attempt kembali menjadi `IN_PROGRESS`, hitungan pelanggaran menjadi nol, dan jawaban sebelumnya tetap tersedia.

Saat deploy, jalankan:

```bash
php database/migrate.php
```

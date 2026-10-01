# Persiapan beban ujian

## Perubahan yang aman

- Dashboard, Live Sessions, tiket staf, dan chat staf memakai refresh manual.
- Countdown Live Sessions hanya perkiraan lokal; status/progres tetap snapshot
  sampai pengguna menekan Perbarui. Jangan menganggap status itu real-time.
- Autosave, heartbeat, submit, dan polling bantuan siswa tetap aktif.
- Worker Portal memakai revisi untuk menghindari sinkronisasi yang tidak berubah.
  Portal lama tanpa revisi pegawai memakai interval fallback, bukan setiap putaran.
- Finalizer ujian harus tetap berjalan. Jangan menghapus antrean/jawaban/sesi.
- Simpan jawaban hanya mengambil metadata attempt yang diperlukan, tanpa JSON
  urutan soal. Jawaban identik tidak ditulis ulang, tetapi revisi mutation tetap
  maju agar deteksi konflik dan retry tetap benar.
- Submit tidak mengambil isi opsi HTML/gambar untuk soal pilihan tunggal/isian.
  Soal pilihan kompleks tetap mengambil opsi untuk menghitung penalti dengan benar.

Setelah deploy, staf harus memuat ulang tab dashboard yang sudah terbuka agar
polling JavaScript versi lama berhenti. Jangan memaksa reload tab ujian siswa.

## Konfigurasi worker di VPS

Ubah baris yang sudah ada di `.env`, jangan membuat duplikat:

```dotenv
PORTAL_DATA_SYNC_INTERVAL=60
PORTAL_DATA_SYNC_FULL_INTERVAL=3600
PORTAL_DATA_SYNC_EMPLOYEE_INTERVAL=300
```

Perubahan referensi Portal dapat terlambat sampai interval pemeriksaan; jika Portal
tidak menyediakan revisi pegawai, perubahannya dapat terlambat sampai lima menit.
Sinkronisasi manual masih tersedia. Lakukan sinkronisasi peserta dan penugasan
sebelum ujian, bukan saat seluruh siswa serentak login.

Worker CLI yang sudah berjalan tidak membaca ulang kode atau `.env`. Identifikasi
unit systemd/Supervisor yang menjalankan **scripts/sync-portal.php milik CBT** lalu
restart hanya worker tersebut selama jeda. Reload PHP-FPM tidak me-restart worker
CLI. Jangan menjalankan worker tambahan atau restart seluruh Supervisor.
Interval ini berlaku untuk worker yang hidup terus. Cron `--once` memulai proses
baru tanpa state revisi sehingga melakukan sinkronisasi penuh setiap eksekusi;
jangan menjadwalkannya setiap menit selama ujian besar.

## Verifikasi sebelum dua angkatan

1. Uji login, simpan jawaban, reload, submit, dan hasil menggunakan akun tes.
2. Mulai bertahap sampai jumlah peserta target sebenarnya. Uji juga lonjakan
   masuk ujian dan submit bersama; kondisi idle tidak membuktikan kapasitas.
3. Catat jumlah peserta, request gagal, p95 waktu simpan/submit, antrean FPM,
   dan latensi disk. Nol HTTP 500 saja tidak cukup: cek jawaban dan hasil tersimpan.
4. Pantau `iostat -xz 1 10` dan log Arena. Pada insiden sebelumnya, disk memiliki
   utilisasi sekitar 95–100%, write await sampai 125 ms, dan MySQL menunggu commit.
   Itu perlu diperiksa di storage host VPS; menambah worker PHP bisa menambah antrean.
5. Jangan menurunkan durability MySQL, menonaktifkan CSRF, membersihkan cache terus,
   atau menghapus data untuk mengejar angka throughput.

Kode ini tidak membuktikan server mampu dua angkatan. Jika tes target masih
timeout, gunakan gelombang masuk terjadwal dan perbaiki storage sebelum ujian.

## Hasil uji lokal 1 Oktober 2026

- 78 pemeriksaan integrasi MySQL terisolasi lulus.
- Simulasi 200 siswa, 40 soal, 8 proses PHP lokal: 17.800 request, 200 peserta
  berhasil, nol gagal, durasi 201,5 detik.
- P95 simpan jawaban 3.123 ms; submit 7.214 ms; maksimum seluruh request 7.758 ms.
- Termasuk retry jawaban identik, submit berulang, pemulihan hasil, dan verifikasi
  nilai. Redis dinonaktifkan untuk menguji fallback database.
- Ini bukan benchmark PHP-FPM/Nginx/Cloudflare atau storage VPS produksi.
  Belum ada pembuktian kapasitas dua angkatan pada infrastruktur produksi.

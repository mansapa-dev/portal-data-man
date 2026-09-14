# SIPINTAR Multimedia — PHP native

Proyek ini memiliki kode, konfigurasi, database, akun, role, dan **satu superadmin sendiri**. Seluruh kode aplikasi berada dalam folder `sipintarmultimedia`. Folder ini bisa dipasang sendiri di root domain atau subdirektori dengan nama apa pun.

Sumber data pegawai tetap **portal-data-man**. Aplikasi menyimpan cache referensi `publicId`, nama, NIP, dan status aktif dari sumber tersebut. Cache hanya diperbarui melalui sinkronisasi, bukan diedit sebagai master pegawai. Akun, password, dan role dikelola oleh superadmin proyek ini; pengaturan tersebut tidak disinkronkan ke proyek lain atau Portal Data.

## Struktur

- `index.php`, `admin.php`, `employees.php`: halaman aplikasi, pengaturan lokal, pencarian pegawai.
- `app/`: bootstrap, sesi, otorisasi, client Portal Data, dan layanan bisnis.
- `assets/`: JavaScript lokal, dengan URL mengikuti lokasi pemasangan proyek.
- `database/`: skema akun lokal dan skema bisnis untuk instalasi baru.
- `bin/console.php`: migrasi, pembuatan superadmin, sinkronisasi pegawai.
- `tests/`: pemeriksaan logika, database, dan HTTP untuk proyek ini.

## Akun dan role

Constraint UNIQUE + CHECK pada `accounts.superadmin_slot` memastikan maksimal satu superadmin di **database proyek ini**. CLI membuat akun pertamanya; form pengaturan tidak dapat membuat/mengubah/menonaktifkan superadmin. Proyek lain dapat memiliki superadmin sendiri.

| Role awal | Akses lokal |
|---|---|
| pegawai | Buat peminjaman atas nama sendiri |
| petugas | Kelola peminjaman, pengembalian, dan laporan |
| pemantau | Lihat laporan peminjaman |
| superadmin | Seluruh izin peminjaman |

Superadmin dapat membuat role baru, mengubah izin, membuat akun pegawai, menonaktifkan akun, dan memilih “Tanpa akses”. Satu pegawai Portal dapat memiliki satu akun lokal pada proyek ini, dengan password dan role yang berbeda dari proyek lain. Perubahan role berlaku pada permintaan berikutnya.

Panel pengelolaan akun dan role telah dinonaktifkan dari aplikasi, termasuk URL `admin.php`. Akun yang telah ada tetap aktif sesuai status dan role terakhirnya.

Cookie sesi proyek ini bernama `SIPINTAR_MULTIMEDIA_SESSION`, dibatasi ke path pemasangan. Login/logout proyek lain tidak mengubah sesi di sini. Password disimpan sebagai hash; POST memerlukan CSRF. Percobaan login dibatasi. Tabel `users` lama hanya dibaca saat migrasi; setelah itu login memakai `accounts` dengan hash password lama yang sama.

## Pemasangan

Memerlukan PHP 8.1+ dengan `pdo_mysql`, `mysqli`/mysqlnd, `curl`, serta MySQL 8.0.16+ atau MariaDB 10.4+ menggunakan InnoDB. Gunakan HTTPS pada deployment.

1. Siapkan database khusus proyek ini. Tabel akun/role/cache pegawai dan transaksi berada dalam database tersebut. Gunakan database berbeda untuk proyek yang lain.
2. Untuk **instalasi baru**, impor `database/schema.sql`. Untuk database bisnis yang sudah berisi data, backup dan gunakan migrasi pada langkah berikut; jangan impor ulang skema baru. Dump lama berisi contoh data tidak diperlukan untuk instalasi baru.
3. Salin `config.example.php` ke lokasi di luar document root, misalnya `/etc/sipintarmultimedia/config.php`, lalu isi koneksi database proyek ini dan konfigurasi Portal Data. Set `SIPINTARMULTIMEDIA_CONFIG` pada PHP-FPM/Apache serta CLI/cron. Jika hosting tidak menyediakan pengaturan environment untuk PHP, aplikasi juga membaca `config.php` di folder proyek saat variabel itu kosong. File lokal tersebut diabaikan Git dan diblokir oleh `.htaccess` Apache; pada Nginx, lindungi `config.php` dengan aturan setara. File harus dapat dibaca pengguna PHP. `cookie_secure=false` hanya untuk localhost HTTP.
4. Dari folder proyek ini, jalankan:

```bash
export SIPINTARMULTIMEDIA_CONFIG=/etc/sipintarmultimedia/config.php
php bin/console.php migrate
php bin/console.php migrate-business
read -rsp 'Password superadmin (min. 12 karakter): ' SIPINTARMULTIMEDIA_ADMIN_PASSWORD
export SIPINTARMULTIMEDIA_ADMIN_PASSWORD
php bin/console.php superadmin superadmin
unset SIPINTARMULTIMEDIA_ADMIN_PASSWORD
```

Migrasi dapat dijalankan ulang. `migrate` membuat tabel akun lokal dan role awal, lalu mengimpor pengguna dari tabel `users` lama ke `accounts` tanpa mengubah password atau data peminjaman. Akun lama diberi izin `petugas` seperti akses pengelolaan sebelumnya; akun dengan username yang sudah ada di `accounts` dibiarkan utuh. `migrate-business` hanya memigrasikan tabel bisnis proyek ini. Jalankan migrasi sebelum mengaktifkan kode baru. Jika memakai dump `db_sarpras` lama, arahkan konfigurasi database ke database tersebut dan jalankan `php bin/console.php migrate` serta `php bin/console.php migrate-business`; tanpa tabel identitas baru, login akan gagal dengan HTTP 500. Database akun gabungan dari rancangan sebelumnya tidak digunakan: jika pernah mencoba rancangan itu, buat akun lokal melalui panel proyek ini berdasarkan pegawai Portal.

5. Buka `admin.php` pada URL pemasangan, masuk sebagai superadmin proyek ini, sinkronkan pegawai, kemudian buat akun dan tetapkan role lokalnya.

## Integrasi sumber pegawai

Di portal-data-man, siapkan application client **SERVICE**, status **ACTIVE**, grant `client_credentials`, scope `portal_data.read`. Isi konfigurasi:

- `portal.token_url`: URL token Portal, biasanya `https://host-portal/oidc/token`.
- `portal.teachers_url`: sumber pegawai yang sama untuk kedua proyek, saat ini `https://host-portal/api/v1/integration/cbt/teachers`.
- `portal.client_id` dan `portal.client_secret`: kredensial service client proyek ini. Sebaiknya setiap proyek memiliki service client sendiri agar pencabutan akses dapat dilakukan terpisah.

Sesuaikan URL dengan subdirektori Portal bila ada. Jalankan sinkronisasi dari panel atau CLI:

```bash
php bin/console.php sync-employees
```

Perintah bisa dijadwalkan lewat cron. Token diminta otomatis server ke server melalui HTTPS; secret tidak dikirim ke browser. Seluruh halaman respons diambil sebelum cache lokal diganti secara transaksional. Kegagalan/format tidak valid/snapshot kosong mempertahankan cache sebelumnya. Pegawai yang tidak lagi ada pada snapshot aktif kehilangan akses lokal setelah sinkronisasi; superadmin tetap dapat masuk.

**Cakupan sumber:** endpoint yang tersedia dalam portal-data-man saat ini memakai `Teacher` (guru aktif). TU/non-guru yang belum tercatat di sana memerlukan endpoint pegawai yang lebih lengkap. Kontrak responsnya berupa `data.data`, `current_page`, `last_page`, dengan baris `id`, `name`, `nip`. Kedua proyek perlu diarahkan ke sumber master yang sama saat endpoint tersebut tersedia. Kode portal-data-man tidak diubah dalam pemisahan ini.

## Kapasitas dan operasional

- Riwayat peminjaman dibatasi 50 baris per halaman; filter dijalankan di server. Ekspor memuat seluruh hasil filter.
- Peminjaman memakai prepared statements, jumlah positif, validasi tanggal, dan ID acak 64-bit. Pengembalian hanya melalui POST dengan CSRF dan izin petugas.
- Pegawai membuat peminjaman atas nama sendiri. Petugas dapat memilih pegawai lain dari sumber Portal. Riwayat menyimpan snapshot nama/NIP agar tetap terbaca setelah data master berubah.
- Pencarian pegawai dibatasi 30 hasil dan daftar akun 50 hasil per halaman. Izin di-cache selama satu request.
- Arsitektur ini belum diuji beban produksi. Beberapa server untuk proyek yang sama memerlukan penyimpanan sesi bersama dan database proyek yang sama, konfigurasi PHP-FPM/OPcache, serta uji beban sesuai trafik. Ekspor besar dapat dikembangkan menjadi pekerjaan latar belakang.

Apache: aktifkan aturan `.htaccess` (`AllowOverride`) untuk melindungi `app/`, `bin/`, `database/`, `tests/`, konfigurasi, dan dump SQL. Pada Nginx, buat aturan setara. Hanya entry point PHP di root dan `assets/` yang perlu diakses publik.

## Pengujian lokal

Dari folder proyek ini:

```bash
php tests/run.php
# Opsional: MariaDB/MySQL sementara, root lokal tanpa password:
SIPINTAR_TEST_SOCKET=/tmp/sipintar-test.sock php tests/run.php
SIPINTAR_TEST_SOCKET=/tmp/sipintar-test.sock python3 tests/http_flow.py
```

Uji dasar memakai `pdo_sqlite` in-memory dan memeriksa dua database identitas independen dengan pegawai Portal yang sama. Uji MySQL membuat/menghapus database `sipintar_test_*`. Uji HTTP membutuhkan Python 3 dan Node, membuat database `sipintar_http_*`, menyalin hanya folder proyek ini ke lokasi sementara, lalu mengujinya di root situs dan subfolder bernama lain. Cookie proyek lain diuji agar tidak bisa digunakan sebagai sesi lokal.

Test socket harus menunjuk server pengujian, bukan produksi. Pengujian lokal tidak menghubungi Portal Data sebenarnya; sinkronisasi live dan deployment memerlukan konfigurasi server.

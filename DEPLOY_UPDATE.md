# Panduan Pull dan Deploy

Commit rilis: `5c7c6d66` (`feat: redesign agent and teacher portals`).

## 1. Update source di server

Jalankan dari folder repository pada server:

```bash
cd /path/ke/portal-data
git status
git pull --ff-only origin main
```

Jika `git status` menampilkan perubahan lokal yang masih diperlukan:

```bash
git stash push -u -m "backup sebelum deploy"
git pull --ff-only origin main
git stash pop
```

Jangan menimpa atau menghapus file `.env`, storage upload, maupun signing key OIDC.

## 2. Deploy backend SIPADU

Masuk ke aplikasi Laravel SIPADU:

```bash
cd portal-data-man/laravel
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

Pull backend wajib dilakukan. ZIP build frontend saja tidak memuat endpoint baru untuk daftar aplikasi Portal Guru.

## 3. Upload build SIPADU melalui cPanel

Arsip yang disiapkan bernama `sipadu-public-build.zip`. Isinya:

```text
build/
  manifest.json
  assets/
    main-BqYz5tDv.css
    main-ClUEy5cj.js
```

Langkah di File Manager:

1. Buka document root Laravel SIPADU, lalu masuk ke folder `public`.
2. Backup atau rename folder `build` lama menjadi `build-backup`.
3. Upload `sipadu-public-build.zip` ke folder `public`.
4. Extract ZIP tersebut. Pastikan hasil akhirnya `public/build/manifest.json`, bukan `public/build/build/manifest.json`.
5. Buka SIPADU menggunakan mode incognito atau lakukan hard refresh.
6. Setelah tampilan baru terverifikasi, folder `build-backup` dan ZIP di server boleh dihapus.

## 4. Deploy Agen

Setelah source berhasil di-pull:

```bash
cd agen/jurnal-kelas
composer install --no-dev --optimize-autoloader
php database/migrate.php
```

Agen menggunakan CSS dan JavaScript statis yang sudah masuk Git, jadi tidak memerlukan `npm run build`.

Pastikan document root domain Agen tetap mengarah ke:

```text
agen/jurnal-kelas/public
```

## 5. Verifikasi

- Login Agen harus kembali ke dashboard Agen setelah autentikasi SIPADU.
- Scanner absensi harus menerima barcode berisi tepat 10 digit NISN.
- Tambah jurnal harus dapat mengunggah 1–5 foto dokumentasi.
- Tambah admin tidak boleh lagi crash ketika respons tidak memuat `data.publicId`.
- Portal Guru harus menampilkan aplikasi yang diberikan lewat menu Aplikasi SSO.
- Jika kartu Agen belum muncul, berikan akses guru dari **Aplikasi SSO → Agen → Akses Guru**.

Jika route baru belum terbaca, jalankan kembali:

```bash
php artisan optimize:clear
php artisan route:cache
```

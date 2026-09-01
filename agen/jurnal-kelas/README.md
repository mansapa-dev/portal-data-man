# Jurnal Kelas — MAN 1 Palembang

Aplikasi PHP native modular untuk absensi dan jurnal pembelajaran. Proyek menargetkan PHP 8.2+, MySQL/MariaDB, dan shared hosting cPanel dengan `public/` sebagai document root.

## Status implementasi

Tahap 1 tersedia: struktur clean architecture, konfigurasi environment, dependency container, PDO connection, HTTP request/response, router ULID, middleware session/CSRF/header keamanan, canonical database schema, migration runner, seed konfigurasi aman, halaman awal, dan unit test value object.

Integrasi awal Tahap 2 juga tersedia: OIDC Authorization Code + PKCE, validasi state/nonce/issuer/audience/signature JWKS, sinkronisasi snapshot akun guru, logout SSO, dan client read-only kelas/periode/siswa Portal Data. Lihat `docs/portal-data-configuration.md`.

Session login dicatat sebagai hash di database, divalidasi pada setiap route terlindungi, dan dicabut saat logout. Tahap 3–5 menyediakan alur absensi, jurnal, dashboard guru/admin dasar, laporan bulanan, Excel, dan PDF. Tahap 6 menambahkan audit log read-only, append-only trigger, role authorization, rate limiting scan, security headers, payload limits, responsive layout, reduced motion, focus indicator, skip link, dan semantic live state. Tahap 7 memiliki unit, integration, serta feature/security test awal; suite penuh end-to-end belum selesai dan aplikasi belum dinyatakan production-ready.

## Menjalankan secara lokal

```bash
composer install
cp .env.example .env
composer migrate
composer seed
composer test
php -S localhost:8080 -t public
```

Isi `APP_KEY` dengan nilai acak minimal 32 byte dan konfigurasi database pada `.env`. Jangan commit `.env`.

## Arsitektur

- `app/Domain`: aturan bisnis murni dan value object.
- `app/Application`: use case/orchestration tanpa detail HTTP.
- `app/Http`: controller, middleware, request, response, router.
- `app/Repositories`: kontrak dan implementasi repository.
- `app/Infrastructure`: PDO, file private, export, logging, keamanan, Portal Data.
- `resources/views`: presentation dengan output escaping.
- `public`: satu-satunya folder yang boleh terekspos web.
- `storage/app/private`: dokumentasi jurnal, tidak dapat diakses langsung.

Dependency mengarah ke dalam: HTTP dan Infrastructure memakai Application/Domain; Domain tidak bergantung pada database atau framework.

## Database

Schema canonical ada di `database/schema.sql`. Constraint utama meliputi ULID unik, satu record per siswa/session, satu jurnal per attendance session, jam 1–11, foreign key `RESTRICT`/`SET NULL`, dan audit log tanpa cascade delete.

### Mata pelajaran TA 2026/2027

Daftar mata pelajaran aktif dimasukkan oleh `php database/seed.php`: Biologi, Kimia, Fisika, Matematika Wajib, Matematika Tingkat Lanjut, Geografi, Sosiologi, Ekonomi, Sejarah, Sejarah Tingkat Lanjut, Bahasa Indonesia, Bahasa Inggris, Bahasa Inggris Tingkat Lanjut, Bahasa Arab, Tahfidz, Akidah Akhlak, Pendidikan Pancasila, Al-Qur'an Hadist, Fikih, Sejarah Kebudayaan Islam, Seni Budaya, Informatika, PJOK, dan BK.

## Endpoint Tahap 1

- `GET /` — halaman status fondasi.
- `GET /dashboard` — halaman status fondasi.
- `GET /health` — health response JSON.
- `GET /api/classes` — cache kelas aktif dari Portal Data (authenticated).
- `GET /api/periods` — cache periode dan semester (authenticated).
- `GET /api/classes/{publicId}/students` — anggota kelas terkini dari Portal Data (authenticated).
- `GET /attendance/create` — form pembuatan draft absensi.
- `GET /attendance/{publicId}` — checklist dan scanner absensi.
- `POST /api/attendance` — membuat snapshot sesi dan siswa.
- `PATCH /api/attendance/{publicId}/students/{studentPublicId}` — mengubah status siswa.
- `POST /api/attendance/{publicId}/scan` — menandai hadir berdasarkan NISN.
- `POST /api/attendance/{publicId}/mark-all-present` — menandai seluruh `UNMARKED` sebagai hadir.
- `POST /api/attendance/{publicId}/finalize` — finalisasi jika tidak ada `UNMARKED`.
- `GET /journals` dan `GET /journals/{publicId}` — daftar dan detail jurnal guru.
- `GET /journals/create` — membuat jurnal dari absensi final.
- `POST /api/journals` dan `PATCH /api/journals/{publicId}` — lifecycle draft jurnal.
- `POST /api/journals/{publicId}/documentations` — upload dokumentasi private tervalidasi.
- `GET /api/journals/{publicId}/documentations/{filePublicId}` — akses file terautorisasi.
- `POST /api/journals/{publicId}/finalize` — finalisasi jurnal dengan dokumentasi.
- `POST /api/journals/{publicId}/revision` — revisi jurnal final dengan alasan dan history.
- `DELETE /api/journals/{publicId}` — soft delete khusus draft.
- `GET /reports/monthly` — laporan bulanan guru.
- `GET /reports/monthly/excel` dan `/pdf` — export dari query backend.

Endpoint bisnis baru akan didaftarkan ketika implementasinya benar-benar tersedia.

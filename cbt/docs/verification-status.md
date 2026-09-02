# Verification Status

Tanggal verifikasi: 2 September 2026.

| Area | Status | Bukti/catatan |
|---|---|---|
| Full read `index.html` | PASS | 2.138 baris diaudit |
| Full read `code.gs.txt` | PASS | 715 baris diaudit |
| PHP syntax | PASS | Semua file `app` dan `public` lulus `php -l` memakai PHP lokal 8.1.10 |
| JavaScript adapter syntax | PASS | `node --check public/assets/js/native-api-adapter.js` dan `cbt-app.js` exit 0 |
| Artificial participant examples | PASS | Pencarian `UG-*`, `CBT-*`, dan `UJI-*` tidak menemukan sisa setelah perbaikan |
| Schema import MySQL/MariaDB | NOT VERIFIED | Belum ada credential/database CBT lokal pada `.env` |
| Student login integration | NOT VERIFIED | Membutuhkan schema, data sync, dan PIN hash |
| Portal Data live API | NOT VERIFIED | Base URL/API key belum dikonfigurasi |
| Concurrent autosave/submit | NOT VERIFIED | Implementasi transaction/unique/row lock tersedia; load test belum dijalankan |
| UI visual parity | EXCLUDED | Tidak dijalankan sesuai arahan user pada tahap ini |
| Legacy backend call coverage | PASS | Seluruh nama fungsi backend yang dipanggil `index.html` tersedia pada compatibility bridge |
| Admin/teacher PHP syntax | PASS | Dashboard, ujian, soal, akun, assignment, hasil, pelanggaran, siswa CBT state, dan monitoring guru lulus lint |
| Admin/teacher runtime parity | NOT VERIFIED | Membutuhkan schema MySQL, initial admin, data Portal sync, serta browser test |
| Import validation | PASS | Import soal/akun mengembalikan jumlah berhasil/gagal dan detail nomor baris; syntax/flow statis diverifikasi |
| Separate teacher pages | PASS | Login dan dashboard guru berada pada view serta aset JS terpisah; PHP/JS syntax check lulus |
| Teacher NIP contract | PASS | Login guru mencari NIP pada local reference hasil Portal sync dan akun direlasikan melalui `teacher_id` |
| Audit logging coverage | PASS | Login, credential, submit, violation, sync, reset, ujian, soal, akun, dan assignment memakai audit middleware |
| Automated non-browser tests | PASS | `tests/run.php`: 13 passed, 0 failed |
| Resume jawaban/ragu dan offset timer server | PASS | Adapter memulihkan `is_flagged`; timer memakai offset `server_time`; automated contract test dijalankan |
| Portal Data CBT routes syntax | PASS | Controller, middleware, config, bootstrap, dan routes lulus `php -l` |
| Portal Data CBT route runtime | NOT VERIFIED | Dependency `vendor` Portal Data belum tersedia sehingga `artisan route:list` belum dapat dijalankan |
| Shared-hosting deployment runbook | PASS | Mencakup requirements, document root, env, database, build lokal, initial admin, sync, health, update, backup, rollback, dan troubleshooting |
| CBT deployment preflight syntax | PASS | `scripts/preflight.php` lulus `php -l`; pemeriksaan production belum dijalankan karena `.env` belum tersedia |
| CBT health endpoint syntax | PASS | `/health` dan query database lulus syntax check; runtime production belum diverifikasi |

Tidak ada status runtime yang ditandai PASS tanpa benar-benar dijalankan.

# Rencana Implementasi

## Audit keputusan arsitektur

1. Portal Data tetap menjadi master guru, siswa, kelas, enrollment, dan periode.
2. Jurnal Kelas hanya menyimpan identitas user lokal serta snapshot data pada transaksi historis.
3. Autentikasi production memakai OIDC Authorization Code + PKCE; provider development harus mengikuti kontrak yang sama dan tidak menyimpan password Portal Data.
4. Attendance session dan journal mempunyai hubungan satu-ke-satu. Pembentukan awal menggunakan transaksi dan foreign key dua arah untuk menjaga keterlacakan.
5. Jurnal final bersifat immutable. Koreksi dibuat sebagai revision dengan alasan, before/after, dan audit.
6. File dokumentasi berada di private storage dan hanya diberikan melalui controller terautorisasi.

## Tahapan

- Tahap 1: fondasi arsitektur, schema, bootstrap, router, container, error handling — sudah dibangun.
- Tahap 2: OIDC AuthProvider, session database, CSRF, dan PortalDataClient read-only sudah tersedia; RBAC lengkap, cache persisten, retry/circuit breaker, serta test end-to-end masih perlu diselesaikan.
- Tahap 3: create attendance, checklist responsif, scan BarcodeDetector/manual NISN, koreksi, summary, dan finalisasi dasar tersedia; ZXing lokal, rate limiting, persistence draft recovery UI, dan integration/security test masih harus diselesaikan.
- Tahap 4: lifecycle utama create/list/detail/edit/finalize/revision, private documentation, soft delete draft, delete file, serta history tersedia; print detail, thumbnail, dan integration/security test masih perlu diselesaikan.
- Tahap 5: dashboard guru dan monthly report guru dengan Excel/PDF dari query backend tersedia; dashboard admin, filter admin lintas guru, dan laporan detail absensi masih perlu diselesaikan.
- Tahap 6: audit append-only/read-only UI, RBAC, scan rate limit, header/payload hardening, responsive table/layout, reduced motion, focus, skip link, label dan live-region dasar tersedia; audit aksesibilitas manual penuh masih diperlukan.
- Tahap 7: unit, integration schema, dan feature/security test dasar tersedia; OIDC/upload/export/concurrency/ownership end-to-end dan verifikasi cPanel masih diperlukan.

## Risiko yang harus diverifikasi

- Kontrak endpoint dan claim OIDC Portal Data.
- Apakah Portal Data sudah menyediakan master mata pelajaran; sementara gunakan tabel `subjects` lokal.
- Dukungan `BarcodeDetector` browser target; ZXing harus dibundel sebagai fallback lokal.
- Versi MySQL hosting harus mendukung JSON, CHECK, dan `DATETIME(3)`.

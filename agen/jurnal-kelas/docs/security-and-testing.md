# Security dan Testing

## Hardening aktif

- OIDC Authorization Code + PKCE, state, nonce, issuer, audience, expiry, dan JWKS RS256.
- Session ID diputar setelah login; session database menyimpan hash token dan hash CSRF.
- Cookie HttpOnly, SameSite=Lax, dan Secure pada production.
- CSRF pada seluruh mutation.
- Role mutation hanya `TEACHER`; audit hanya `ADMIN`/`AUDITOR`.
- Rate limit scan 30 percobaan per menit per user dan IP.
- CSP, HSTS production, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP, dan CORP.
- Private upload, magic-byte MIME validation, random filename, size/count limit, dan ownership check.
- Audit log append-only melalui trigger database.
- Batas payload 11 MB dan JSON nesting 64.
- Public URL hanya menerima ULID.

## Menjalankan test

```bash
composer install
composer test
```

Integration test database hanya boleh memakai database test khusus:

```dotenv
TEST_DB_DSN=mysql:host=127.0.0.1;port=3306;dbname=jurnal_kelas_test;charset=utf8mb4
TEST_DB_USERNAME=jurnal_test
TEST_DB_PASSWORD=secret-test
```

Terapkan migration pada database test sebelum menjalankan suite. Test integration otomatis dilewati jika `TEST_DB_DSN` tidak tersedia agar tidak pernah menyentuh database production secara tidak sengaja.

## Cakupan saat ini

- Unit: NISN, ULID, jam pelajaran, finalization policy, monthly summary.
- Feature/security: CSRF, role authorization, penolakan numeric ID/IDOR dasar, output escaping.
- Integration: keberadaan tabel, unique attendance constraint, trigger audit append-only.

Test end-to-end OIDC, upload HTTP aktual, concurrency duplicate scan, export aktual, dan seluruh ownership query masih perlu ditambahkan sebelum aplikasi dinyatakan production-ready.

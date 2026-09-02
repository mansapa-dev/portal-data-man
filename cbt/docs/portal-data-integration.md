# Integrasi CBT dengan Portal Data

Dokumen ini menjelaskan koneksi CBT PHP Native ke Portal Data Laravel. CBT mengambil data guru, siswa, kelas, tahun ajaran, dan semester melalui HTTP API backend. Tidak ada Google Apps Script, Supabase, atau akses langsung ke database Portal Data.

## Konfigurasi

Portal Data (`.env`):

```env
CBT_INTEGRATION_API_KEY=RANDOM_SHARED_INTEGRATION_KEY
```

CBT (`.env`):

```env
PORTAL_DATA_BASE_URL=https://sipadu.example.sch.id
PORTAL_DATA_API_KEY=RANDOM_SHARED_INTEGRATION_KEY
PORTAL_DATA_TIMEOUT=5
PORTAL_DATA_VERIFY_SSL=true
```

Nilai kedua key harus sama. Key hanya disimpan di server dan tidak boleh dimasukkan ke JavaScript, HTML, atau URL.

## Daftar endpoint

Semua endpoint berikut berada di Portal Data dan dilindungi middleware `cbt.integration`:

```text
GET /api/v1/integration/cbt/academic-years
GET /api/v1/integration/cbt/semesters?academic_year_id=<portal_public_id>
GET /api/v1/integration/cbt/students?page=1&per_page=100
GET /api/v1/integration/cbt/teachers?page=1&per_page=100
GET /api/v1/integration/cbt/classes?page=1&per_page=100
```

CBT menyimpan snapshot lokal untuk tetap dapat menjalankan ujian ketika Portal Data sedang tidak tersedia. Portal Data tetap menjadi sumber kebenaran untuk identitas guru, siswa, kelas, tahun ajaran, dan semester.

## Urutan sinkronisasi

1. Pastikan tahun ajaran dan semester aktif sudah dibuat di Portal Data.
2. Import atau perbarui data guru pada menu **Data Guru**.
3. Pastikan kelas dan enrollment siswa sudah benar.
4. Login sebagai admin CBT.
5. Jalankan sinkronisasi kelas, siswa, lalu guru dari menu admin.
6. Buat ujian menggunakan kelas, tahun ajaran, semester, tanggal, jam mulai, dan jam selesai.
7. Buat penugasan ujian kepada guru yang sudah tersinkronisasi.

Setelah seluruh halaman berhasil diambil tanpa error, referensi lokal yang tidak lagi muncul pada daftar aktif Portal akan dinonaktifkan di CBT. Rekonsiliasi ini tidak dijalankan pada sync berstatus `PARTIAL` atau `FAILED`, sehingga gangguan API tidak menonaktifkan cache yang masih valid.

Riwayat sinkronisasi dapat dibaca admin melalui `GET /api/admin/portal-data/sync/status?limit=20`.

## Pengujian koneksi

Tanpa key harus ditolak:

```bash
curl -i https://sipadu.example.sch.id/api/v1/integration/cbt/teachers
```

Dengan key harus berhasil:

```bash
curl -i \
  -H "X-API-Key: RANDOM_SHARED_INTEGRATION_KEY" \
  "https://sipadu.example.sch.id/api/v1/integration/cbt/teachers?page=1&per_page=2"
```

Respons sukses menggunakan format API Portal Data dan tidak boleh mengandung password atau token akun guru.

## Registrasi SSO guru

Sinkronisasi referensi memakai API key server-to-server, sedangkan login guru memakai OIDC Authorization Code + PKCE. Daftarkan CBT pada menu **Aplikasi SSO** Portal Data:

```text
Nama aplikasi: CBT MAN 1 Palembang
Redirect URI: https://cbt.example.sch.id/auth/sso/callback
Post logout redirect URI: https://cbt.example.sch.id/guru
Scope: openid profile email portal_role
```

Isi `PORTAL_DATA_OIDC_ISSUER`, `PORTAL_DATA_OIDC_CLIENT_ID`, dan `PORTAL_DATA_OIDC_REDIRECT_URI` pada `.env` CBT. Berikan akses aplikasi kepada guru di Portal Data. Guru yang valid dan sudah tersinkron akan dihubungkan otomatis ke akun teknis CBT saat login pertama; password Portal tidak pernah diterima atau disimpan CBT.

## Keamanan

- Gunakan HTTPS pada kedua domain.
- Gunakan key acak yang berbeda dari password database.
- Jalankan `php artisan config:cache` setelah mengubah `.env` Portal Data.
- Jangan commit `.env`, API key, export kredensial, atau file seed admin.
- Jika key bocor, ganti nilainya di kedua aplikasi lalu bersihkan cache konfigurasi.

# Konfigurasi Portal Data

> Status: konfigurasi ini belum aktif sampai pembaruan Portal Data berhasil dideploy ke `sipadu.man1palembang.sch.id` dan aplikasi SSO dibuat oleh admin.

## 1. Daftarkan aplikasi

Buka **Portal Data → Aplikasi SSO → Tambah aplikasi**, lalu isi:

### Development lokal dengan document root `public/`

- Nama aplikasi: `Jurnal Kelas`
- Slug: `jurnal-kelas`
- Deskripsi: `Absensi dan jurnal pembelajaran MAN 1 Palembang`
- Redirect URI: `http://localhost:8080/auth/sso/callback`
- Post logout redirect URI: `http://localhost:8080/login`

### Production

- Nama aplikasi: `Jurnal Kelas`
- Slug: `jurnal-kelas`
- Deskripsi: `Absensi dan jurnal pembelajaran MAN 1 Palembang`
- Redirect URI: `https://agen.rdmman1plg.id/auth/sso/callback`
- Post logout redirect URI: `https://agen.rdmman1plg.id/login`

URI harus sama persis dengan konfigurasi `.env`, termasuk skema, port, path, dan trailing slash. Production wajib HTTPS.

## 2. Salin Client ID

Setelah aplikasi dibuat, buka detail aplikasi dan salin Client ID ke `.env` Jurnal Kelas:

```dotenv
PORTAL_DATA_BASE_URL=https://sipadu.man1palembang.sch.id/api/v1
PORTAL_DATA_ISSUER=https://sipadu.man1palembang.sch.id/oidc
PORTAL_DATA_CLIENT_ID=portal_jurnal-kelas_nq1v7vpdlvws0ua8
PORTAL_DATA_REDIRECT_URI=https://agen.rdmman1plg.id/auth/sso/callback
PORTAL_DATA_POST_LOGOUT_REDIRECT_URI=https://agen.rdmman1plg.id/login
```

Client ini bertipe public dan menggunakan PKCE, sehingga tidak membutuhkan client secret. Biarkan `PORTAL_DATA_CLIENT_SECRET` kosong.

## 3. Berikan akses guru

Pada detail aplikasi, pilih guru lalu gunakan role `TEACHER` dan klik **Berikan akses**. Hanya guru aktif dengan akun Portal aktif serta grant aktif yang dapat login dan membaca data referensi.

## 4. Data yang tersedia

Access token dengan scope `portal_data.read` dapat membaca endpoint read-only:

- `GET /api/v1/integration/periods`
- `GET /api/v1/integration/classes`
- `GET /api/v1/integration/classes/{classPublicId}/students?semesterPublicId={semesterPublicId}`

Data yang diberikan meliputi periode akademik, semester, kelas aktif, siswa aktif, NISN, dan nomor absen. Mutation data master tetap hanya dilakukan di Portal Data.

## 5. Login

Jurnal Kelas memakai Authorization Code Flow + PKCE S256, memvalidasi state, nonce, issuer, audience, expiry, dan signature RS256 dari JWKS. Password guru tidak pernah masuk ke aplikasi Jurnal Kelas. Token hanya disimpan pada session server dan tidak ditaruh di localStorage/sessionStorage browser.

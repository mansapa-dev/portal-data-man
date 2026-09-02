# Integrasi CBT dengan Portal Data

CBT mengambil guru, siswa, kelas, tahun ajaran, dan semester melalui HTTP API backend. Portal Data tetap menjadi sumber kebenaran; CBT menyimpan snapshot lokal agar ujian tetap berjalan ketika Portal sementara tidak tersedia.

## Registrasi client sinkronisasi

Di Portal Data buka **Aplikasi & Integrasi → Tambah aplikasi**, lalu pilih **Sinkronisasi CBT — Client Credentials**. Isi nama dan slug, kemudian simpan. Portal menampilkan Client ID dan Client Secret satu kali. Portal hanya menyimpan hash secret di database.

Masukkan keduanya hanya pada `.env` CBT:

```env
PORTAL_DATA_BASE_URL=https://sipadu.example.sch.id
PORTAL_DATA_SYNC_CLIENT_ID=CLIENT_ID_DARI_PORTAL
PORTAL_DATA_SYNC_CLIENT_SECRET=CLIENT_SECRET_DARI_PORTAL
PORTAL_DATA_TIMEOUT=15
PORTAL_DATA_VERIFY_SSL=true
```

Portal Data tidak membutuhkan API key di `.env`. CBT menukar kredensial tersebut dengan access token singkat melalui `POST /oidc/token`, grant `client_credentials`, dan scope `portal_data.read`.

## Endpoint data

Semua endpoint dilindungi bearer access token service:

```text
GET /api/v1/integration/cbt/academic-years
GET /api/v1/integration/cbt/semesters?academic_year_id=<portal_public_id>
GET /api/v1/integration/cbt/students?page=1&per_page=100
GET /api/v1/integration/cbt/teachers?page=1&per_page=100
GET /api/v1/integration/cbt/classes?page=1&per_page=100
```

## Pengujian koneksi

Minta token tanpa menampilkan secret di command history:

```bash
read -rsp "Client secret: " PORTAL_CLIENT_SECRET; echo
TOKEN_RESPONSE=$(curl -sS -X POST https://sipadu.example.sch.id/oidc/token \
  -H "Accept: application/json" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=CLIENT_ID_DARI_PORTAL" \
  --data-urlencode "client_secret=${PORTAL_CLIENT_SECRET}" \
  --data-urlencode "scope=portal_data.read")
unset PORTAL_CLIENT_SECRET
```

CBT melakukan pertukaran token dan refresh otomatis; administrator tidak perlu menjalankan curl dalam penggunaan normal.

## Urutan sinkronisasi

1. Tahun ajaran.
2. Semester.
3. Kelas dan tingkat.
4. Siswa.
5. Guru.

Referensi lokal yang tidak lagi muncul akan dinonaktifkan hanya setelah satu jenis sinkronisasi selesai tanpa kegagalan. Riwayat tersedia melalui `GET /api/admin/portal-data/sync/status?limit=20`.

## SSO guru

Login guru memakai aplikasi terpisah bertipe **SSO Guru — Authorization Code + PKCE**. Daftarkan redirect URI `https://cbt.example.sch.id/auth/sso/callback`, post logout URI `https://cbt.example.sch.id/guru`, lalu isi `PORTAL_DATA_OIDC_CLIENT_ID` di CBT dan berikan akses kepada guru.

Jangan memakai client sinkronisasi sebagai client SSO. Jangan memasukkan Client Secret ke JavaScript, HTML, URL, Git, screenshot, atau tiket support. Bila bocor, gunakan tombol **Buat ulang client secret** pada detail aplikasi; secret lama langsung tidak berlaku.

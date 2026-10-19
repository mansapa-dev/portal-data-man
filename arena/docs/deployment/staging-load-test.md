# Uji beban Arena pada VPS staging

Panduan ini hanya untuk `https://staging.arena.man1palembang.sch.id` dan database `arena_staging`. Runner menolak origin atau database lain, membatasi uji pada 25/50/100 pengguna dan maksimum 10 menit, serta tidak menghapus baris apa pun. Gunakan hanya akun yang dibuat khusus di staging, bukan akun siswa produksi.

## Prasyarat

- Rilis staging sudah memuat patch yang diuji dan `/health/ready` berstatus sehat.
- Buat akun siswa khusus uji beban di database staging. PIN harus berupa PIN uji yang tidak dipakai siswa. Siapkan berkas TSV berisi `NISN<TAB>PIN`, satu akun per baris, tanpa header. Lindungi berkas dengan `chmod 0600`; jangan commit atau menampilkan isinya.
- Untuk autosave dan submit, siapkan ujian terpisah untuk setiap tahap/skenario yang akan dijalankan. Nama ujian wajib berawalan `LOADTEST-`, status aktif, waktu ujian sedang berjalan, memiliki soal objektif dengan opsi atau soal `SHORT_ANSWER`, dan seluruh peserta uji terdaftar sebagai sasaran. Ujian/attempt harus baru karena satu siswa hanya memiliki satu attempt per ujian.
- Siapkan user MySQL baca-saja untuk verifikasi. Batasi grant ke `SELECT` pada `arena_staging.*`. Runner hanya menjalankan query baca.
- Jalankan tiap tahap sebagai command terpisah: 25, kemudian 50, lalu 100. Tinjau hasil dan kondisi VPS/database di antara tahap; jangan otomatis lanjut ke tahap berikutnya.

Autosave akan menyimpan dua perubahan untuk satu soal, memverifikasi jawaban/revision di database, lalu menutup attempt uji melalui endpoint submit dengan konkurensi rendah agar sesi uji tidak tertinggal aktif. Skenario submit menyimpan jawaban awal, kemudian menjalankan autosave terakhir dan submit pada attempt yang sama secara bersamaan. Autosave boleh mendapat `409` jika submit memperoleh lock lebih dulu; jika autosave dikonfirmasi `200`, runner memastikan jawaban tersebut ada di database setelah finalisasi. Timeout/5xx autosave dan submit dicoba ulang satu kali dengan mutation/request yang sama, lalu tetap dihitung sebagai timeout/error pada laporan. Data ujian uji tetap tersimpan untuk audit; runner tidak menghapus siswa, attempt, jawaban, atau hasil.

## Konfigurasi rahasia

Simpan variabel berikut pada file environment privat milik operator, bukan di repository atau command history. URL database harus memakai host MySQL lokal VPS dan nama database persis `arena_staging`.

```dotenv
ARENA_LOADTEST_API_URL=https://staging.arena.man1palembang.sch.id
ARENA_LOADTEST_DATABASE_URL=mysql://arena_loadtest_audit:<password-url-encoded>@127.0.0.1:3306/arena_staging
ARENA_LOADTEST_DB_NAME=arena_staging
ARENA_LOADTEST_CONFIRM_STAGING=I_ACCEPT_STAGING_DATA_CREATION
ARENA_LOADTEST_USERS_FILE=/etc/arena/loadtest-users.tsv
ARENA_LOADTEST_TIMEOUT_MS=20000
ARENA_LOADTEST_MAX_DURATION_MS=600000
```

`ARENA_LOADTEST_SCENARIO` harus `login`, `autosave`, atau `submit`. Untuk autosave/submit, `ARENA_LOADTEST_EXAM_ID` harus menunjuk ujian `LOADTEST-` baru yang sudah ditetapkan bagi akun di TSV. `ARENA_LOADTEST_CONCURRENCY` hanya menerima `25`, `50`, atau `100`.

## Perintah satu tahap

Jalankan dari direktori rilis yang sudah dipasang di VPS, setelah memastikan akun dan ujian uji sesuai tahap. Contoh berikut memulai tahap login 25 pengguna:

```sh
cd /opt/arena/releases/<release>
set -a
. /etc/arena/loadtest.env
set +a
ARENA_LOADTEST_SCENARIO=login ARENA_LOADTEST_CONCURRENCY=25 node scripts/staging-loadtest.mjs
```

Untuk tahap lain, ubah `ARENA_LOADTEST_SCENARIO`, `ARENA_LOADTEST_CONCURRENCY`, dan untuk autosave/submit `ARENA_LOADTEST_EXAM_ID`. Menghentikan dengan `Ctrl-C` membatalkan request yang masih berjalan. Attempt staging yang sudah tercipta tidak dihapus dan harus diperiksa/dibiarkan selesai oleh finalizer.

Contoh grant baca-saja (gunakan akun DBA staging yang disetujui; jangan jalankan terhadap database lain):

```sql
CREATE USER 'arena_loadtest_audit'@'127.0.0.1' IDENTIFIED BY '<password-acak>';
GRANT SELECT ON arena_staging.* TO 'arena_loadtest_audit'@'127.0.0.1';
```

## Kriteria keputusan tiap tahap

Lanjutkan dari 25 ke 50 lalu 100 hanya jika:

- 100% jawaban sukses yang dikonfirmasi memiliki satu baris versi dan satu jawaban yang cocok di database; pada autosave revision akhir harus 2.
- Submit menghasilkan tepat satu `exam_results` per attempt, status attempt terminal, dan `benar + salah + kosong = jumlah soal`.
- Tidak ada HTTP 429/5xx, timeout, error API, atau inkonsistensi database. `409` autosave pada skenario race hanya dianggap konflik yang diharapkan jika database menunjukkan jawaban sebelumnya tetap utuh; autosave yang mendapat `200` harus muncul sebagai jawaban tersimpan.
- p95 per endpoint di bawah 2 detik dan p99 per endpoint di bawah 5 detik pada tahap uji; tidak ada pertumbuhan antrean pool/DB yang menetap, lock wait panjang, atau degradasi aplikasi lain di VPS.

Output JSON memberi `pass: true` hanya jika pemeriksaan request, integritas database, dan latency terpenuhi; kode keluar `2` menandakan tahap gagal kriteria, sedangkan kode keluar `1` menandakan konfigurasi/preflight gagal. Jika ada pelanggaran, hentikan eskalasi dan simpan output runner serta metrik MySQL/host untuk investigasi. Ambang latency di atas adalah kriteria uji awal yang diusulkan, bukan SLO sekolah atau bukti kapasitas produksi. Runner tidak menjalankan tes 1.015 pengguna.

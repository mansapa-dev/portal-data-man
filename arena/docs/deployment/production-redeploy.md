# Panduan Re-deploy Arena ke Production

Panduan ini untuk server production dengan layout saat ini:
checkout repositori di `/srv/repos/portal-data-man`, aplikasi Arena di
`/srv/repos/portal-data-man/arena`, dan API dijalankan PM2 cluster
(3 proses, `apps/api/dist/server.js`) melalui `infra/ecosystem.config.cjs`.
Panduan staging tetap ada di [staging-vps.md](staging-vps.md).

> Aturan yang tidak boleh dilanggar:
> 1. Jangan pernah menimpa/menghapus `.env`, secret, `/var/lib/arena/question-images`, signing key OIDC, atau data database.
> 2. `scripts/migrate-local.mjs` **bukan** migrator idempotent — jangan pernah dijalankan ulang di database production yang sudah berisi tabel.
> 3. Reload/restart API hanya pada jendela tanpa ujian berjalan. Finalizer ujian berjalan di dalam proses API; saat API mati, finalizer juga berhenti.

## 0. Isi rilis ini (untuk verifikasi)

Perubahan alur ujian pada commit terbaru (setelah `ee4306a3` — "Optimize Arena exam flow and add Redis grade admission"):

- **Mulai ujian**: gate antrean tingkat XII→XI→X (Redis) dan warm-up cache
  sumber soal berjalan **sebelum** transaksi MySQL dibuka. Siswa yang masih
  menunggu giliran ditolak `HTTP 425` tanpa pernah menyentuh pool MySQL, dan
  transaksi mulai berhenti memegang latensi Redis di antara query-nya.
- **Simpan jawaban**: client mengirim batch tiap 3–4 detik, maksimal 40
  jawaban per transaksi; retry atas respons hilang tetap idempotent lewat
  `mutation_id`; konflik revisi lintas tab tetap `409` dan di-retry client.
- **Selesai ujian**: submit idempotent per `(student_id, exam_id)`; scoring
  tetap sinkron di MySQL; waktu habis menghitung hasil dari jawaban tersimpan.
- Endpoint verifikasi kunci:
  - `POST /api/student/exams/:id/start` — siswa yang belum dibuka tingkatnya menerima `HTTP 425` **tanpa menambah antrean pool MySQL**.
  - `POST /api/student/exams/:id/answers/batch` — `200` + `revisions` per soal; `409` untuk konflik revisi/tab lain.
  - `POST /api/student/exams/:id/submit` — hasil sama meski di-submit dua kali ( dua tab/dua permintaan).
  - `GET /api/admin/exam-admission?exam_id=` dan `POST /api/admin/exam-admission/advance` — kontrol pembukaan tingkat dari portal admin (komponen `ExamAdmissionControl`).

## 1. Checklist pra-deploy

Jalankan di mesin lokal sebelum menyentuh server, dari `arena/`:

```bash
npm ci
npm run build                          # apps/api/dist + apps/web/dist wajib sukses
cd apps/api && node tests/*.test.mjs   # seluruh pengujian lulus (process exit 0)
```

Di server, sebelum mulai:

- [ ] Tidak ada ujian berjalan:
      `SELECT COUNT(*) FROM exam_attempts WHERE status='IN_PROGRESS';` → wajib 0,
      atau reload hanya dengan persetujuan pengawas.
- [ ] Backup database dan folder upload:
      `mysqldump --single-transaction <db-arena> > /backup/arena-$(date +%F-%H%M).sql`
      plus salinan `/var/lib/arena/question-images`.
- [ ] Catat konfigurasi runtime saat ini (`pm2 describe arena-api`:
      `cwd`, jumlah instance, environment) dan `pm2 logs arena-api --lines 50 --nostream`
      sebagai pembanding setelah deploy.
- [ ] Cek `max_connections` MySQL vs `DB_POOL_SIZE × jumlah instance`
      (produksi: 12 × 3 = 36) dan beban layanan lain di VPS yang sama.

## 2. Update source di server

```bash
cd /srv/repos/portal-data-man
git status                            # harus bersih; jika ada perubahan lokal:
# git stash push -u -m "backup sebelum deploy $(date +%F)"
git pull --ff-only origin main
cd arena && git log --oneline -1      # catat commit rilis yang dideploy
```

Jangan menimpa `.env`/secret atau folder storage apa pun.

## 3. Migrasi database (hanya file baru)

Migrasi `arena/database/migrations/` saat ini `001`–`011` dan sudah
diterapkan di production sebelumnya. Rilis berikutnya hanya membawa file baru
(bandingkan dengan `git show --stat origin/main -- arena/database` atau
`git diff <release-lama>..<release-baru> -- database/migrations`).

Jika ada file migrasi baru `NNN_xxx.sql`, terapkan satu per satu sebagai user
DDL, bukan user runtime (`arena_app`):

```bash
mysql -u <arena_migrator> -p <db-arena> < database/migrations/NNN_xxx.sql
```

Pastikan:

- File baru bersifat additif (kolom/indeks/tabel baru). File `005` destruktif dan tidak boleh dijalankan ulang.
- Verifikasi hasil lewat `INFORMATION_SCHEMA`:
  ```sql
  SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = '<kolom-baru>';
  SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '<tabel>' GROUP BY INDEX_NAME;
  ```
- `npm run demo:migrate` hanya untuk database baru/kosong; jangan pernah
  diulang di production (lihat aturan nomor 2 di atas).

## 4. Build di server

```bash
cd /srv/repos/portal-data-man/arena
npm ci                                # jangan sebagai root; pakai user pemilik directory
npm run build
ls -l apps/api/dist/server.js apps/web/dist/index.html   # wajib ada
```

Jangan jalankan build saat ujian berjalan (menghabiskan CPU/RAM server).

## 5. Environment

Tinjau konfigurasi proses sebelum reload:

```bash
pm2 describe arena-api | grep -E "cwd|script|exec mode|instances"
# Tinjau variabel EXAM_/DB_/REDIS (jangan salin nilainya ke tiket/log/chat)
```

Nilai yang diharapkan setelah rilis ini (per proses, di environment PM2/server):

```dotenv
EXAM_GRADE_ADMISSION_ENABLED=true
EXAM_GRADE_ADMISSION_THRESHOLD=300         # ubah hanya dari hasil pengukuran
EXAM_ADMISSION_TIMEZONE=Asia/Jakarta
EXAM_QUESTION_SOURCE_TTL_MS=2000
EXAM_QUESTION_REDIS_TTL_MS=2000
REDIS_URL=redis://<host-pribadi>:6379      # wajib; tanpa Redis gate jatuh ke 503 yang aman
DB_POOL_SIZE=12
DB_QUEUE_LIMIT=10000
```

Jangan menaruh nilai rahasia (`DATABASE_URL`, `REDIS_URL` dengan password,
`AUTH_TOKEN_SECRET`) ke `infra/ecosystem.config.cjs`. Setelah mengubah
environment: `pm2 startOrReload infra/ecosystem.config.cjs --update-env`.

## 6. Aktifkan rilis (PM2 cluster, tanpa henti)

API membaca `apps/api/dist/server.js` saat proses mulai, jadi cukup reload
proses agar dist baru dipakai:

```bash
cd /srv/repos/portal-data-man/arena
pm2 startOrReload infra/ecosystem.config.cjs --update-env   # ARENA_DIR pakai env manager server
pm2 status
pm2 logs arena-api --lines 100
pm2 save
```

Catatan rolling reload:

- Mode `cluster` menyalakan instance baru sebelum yang lama mati; setiap
  instance baru membuka kembali koneksi pool MySQL (tambahan sementara
  `3 × DB_POOL_SIZE`). Pastikan MySQL sanggup menampung lonjakan itu.
- Permintaan siswa yang terpotong reload sudah dilengkapi retry di client;
  yang gagal pasti tampil sebagai `409/503` sesekali — pantau log dan
  status badge "Jawaban belum tersimpan" di halaman ujian.

## 7. Verifikasi (wajib lulus sebelum jendela deploy ditutup)

```bash
pm2 status
curl -fsS http://127.0.0.1:3001/health/live
curl -fsS http://127.0.0.1:3001/health/ready   # harus menunjukkan DB (dan Redis) siap
nginx -t && systemctl is-active nginx           # hanya jika infra/ berubah di rilis
```

Untuk uji alur, gunakan akun ujian dummy, bukan data siswa asli:

1. **Daftar + mulai**: daftar ujian tampil; tombol Mulai membuat attempt dan
   menyajikan soal (status ujian, jendela waktu, target kelas/siswa tetap
   diverifikasi server).
2. **Gate tingkat**: ujian dengan gate aktif; siswa pada tingkat yang belum
   dibuka harus melihat halaman antrean/menunggu — bukan error 425 mentah di
   layar, dan log API tidak menunjukkan antrean pool MySQL yang memanjang.
3. **Simpan jawaban**: isi pilihan tunggal, multiple response, dan isian
   pendek; indikator "Semua perubahan tersimpan" muncul; refresh halaman
   memuat ulang jawaban yang sama.
4. **Selesai ujian**: SELESAI → hasil tampil; hasil sama setelah refresh
   (submit idempotent); submit ganda dari dua tab tidak menggandakan
   `exam_results`.
5. **Waktu habis**: pada ujian dummy berdurasi singkat, biarkan kadaluarsa →
   hasil dihitung dari jawaban tersimpan.
6. **Kontrol pembukaan tingkat (admin)**: `GET /api/admin/exam-admission?exam_id=…`
   menampilkan stage saat ini; aksi `advance` dari portal admin menaikkan
   `current_grade` dan menulis audit `EXAM_ADMISSION_ADVANCED`.

Integritas data pasca-deploy:

```bash
mysql <db-arena> -e "SELECT status, COUNT(*) FROM exam_attempts GROUP BY status;"
mysql <db-arena> -e "SELECT COUNT(*) results, COUNT(DISTINCT attempt_id) uniq FROM exam_results;"
```

`results == uniq` wajib. Jika tidak cocok, jangan panik dan jangan hapus
data: catat commit rilis, simpan `pm2 logs`, dan ikuti proses rollback di
bagian 8 untuk memulihkan layanan, lalu investigasi dengan data yang utuh.

## 8. Rollback

Rollback kode dengan mengembalikan commit stabil; tidak ada "un-migrate":

```bash
cd /srv/repos/portal-data-man
git log --oneline -5
git checkout <commit-stabil>
cd arena && npm ci && npm run build
pm2 startOrReload infra/ecosystem.config.cjs --update-env
```

Prinsipnya:

- Skema database selalu dibuat additif sehingga kode lama boleh berjalan
  di database baru; kolom/indeks baru tidak perlu dibalik.
- Untuk gate antrean, darurat yang cepat adalah menonaktifkan fitur:
  `EXAM_GRADE_ADMISSION_ENABLED=false` lalu `pm2 restart arena-api --update-env`
  (semua tingkat langsung dibuka; attempt yang sudah jalan tidak terganggu).
- Deployment tidak pernah menghapus data (attempt, jawaban, hasil).
  Jangan memulihkan backup dengan cara menimpa database production kecuali
  disetujui pemilik data dan paham data yang hilang sejak backup.
- Komponen infrastruktur (nginx, sysctl, drop-in systemd, Redis) hanya
  disentuh bila `infra/` berubah pada rilis; panduan per komponen ada di
  [../ops/README.md](../ops/README.md).

## 9. Catatan operasional pasca-rilis

- **Diagnostik tanpa PII**: set `ARENA_EXAM_DIAGNOSTICS=true` hanya selama
  jendela ujian untuk melihat p50/p95/p99 per event (`exam_start`,
  `exam_batch`, `exam_autosave`, `exam_heartbeat`, `exam_admission`); matikan
  kembali setelah gelombang.
- **Gate antrean**: jika gelombang tingkat tertentu selesai lebih cepat dari
  rencana, gunakan kontrol admin (`ExamAdmissionControl` atau
  `POST /api/admin/exam-admission/advance`) untuk membuka tingkat berikutnya
  secara manual; threshold tidak perlu diubah saat ujian berlangsung.
- **Cache soal 2 detik**: hasil edit soal oleh admin hanya perhitungkan
  attempt yang dimulai setelah TTL berlalu; ini keputusan desain untuk
  melindungi kecepatan mulai, bukan bug.
- **Ukuran pool 12 × 3 = 36**: naikkan `DB_POOL_SIZE` hanya dengan
  membandingkan `pool_wait_ms` diagnostik, `max_connections` MySQL, dan
  beban layanan lain di VPS.

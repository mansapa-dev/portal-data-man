# Full redeploy ARENA — 1.200 siswa per sesi

Panduan ini adalah prosedur lengkap untuk memasang ulang ARENA dari checkout
bersih: backup, build, migrasi 014–016, environment, PM2, Nginx/Cloudflare,
verifikasi, aktivasi bertahap submit asinkron, pemantauan, dan rollback.

Target acuan: **arena.man1palembang.sch.id**, VPS **4 vCPU / RAM 16 GB / disk
120 GB**, MySQL dan Redis pada VPS yang sama. Sesuaikan path, nama database,
dan akun dengan server aktual. Jalankan `npm` dan `pm2` sebagai user aplikasi
yang selama ini menjalankan ARENA, bukan root.

> Dokumen ini menggabungkan panduan sebelumnya
> ([production-redeploy.md](production-redeploy.md)) dengan perubahan Tahap 3
> (pemerataan beban) dan Tahap 4 (pemerataan login + bulkhead pool auth).
> Perintah di sini **tidak dijalankan otomatis** oleh agent. Tidak ada perubahan
> production yang dilakukan saat dokumen ini dibuat.

## 0. Ruang lingkup dan aturan aman

Yang berubah dibanding rilis kapasitas awal:

| Tahap | Perubahan | Dampak deploy |
| --- | --- | --- |
| 1 | Cache soal Redis + revision authoritative | Butuh Redis; migrasi 015 |
| 2 | Submit asinkron durable + worker finalisasi | Butuh migrasi 016; flag `SUBMIT_ASYNC` tetap `off` di production |
| 3 | Jitter claim/autosave/auto-submit, backoff `/result`, SSE per siswa, claim timeout 60 dtk, diagnostik beban | Hanya kode + env; tanpa migrasi baru |
| 4 | Jitter login, retry `Retry-After`, pool auth terpisah | Hanya kode + env; tanpa migrasi baru |

Aturan wajib:

1. **Jangan** menjalankan `scripts/migrate-local.mjs` atau `npm run demo:migrate`
   pada database production. Skrip itu untuk database demo kosong.
2. **Jangan** menimpa `.env`, secret, database, atau direktori gambar soal.
3. **Jangan** mengaktifkan `SUBMIT_ASYNC` di production pada redeploy ini.
   Aktifkan hanya di staging setelah migrasi 016 dan rehearsal lulus.
4. **Jangan** menjalankan load test pada data peserta production.
5. Lakukan saat tidak ada ujian aktif. Tutup admission lewat panel admin dan
   pastikan tidak ada attempt `IN_PROGRESS`.
6. Jangan menghapus data/volume untuk rollback. Rollback aplikasi tidak berarti
   restore database.

## 1. Prasyarat

- Node.js **>= 22** dan npm pada server.
- MySQL 8.x dengan database ARENA dan user migrator yang berhak DDL/trigger.
- Redis privat dengan **AOF aktif** dan `maxmemory-policy noeviction`.
- PM2 global untuk user aplikasi.
- Nginx sebagai reverse proxy dan penyaji `apps/web/dist`.
- Cloudflare (opsional tetapi direkomendasikan) untuk aset statis; API, auth,
  HTML, dan gambar soal privat **tidak boleh** di-cache.
- Ruang disk cukup untuk backup, build, Redis AOF, dan log. 120 GB bukan
  seluruhnya ruang bebas.
- Secret yang sudah ada: `AUTH_TOKEN_SECRET`, `PIN_ENCRYPTION_KEY`, kredensial
  database/Redis, serta konfigurasi OIDC/Portal Data. Jangan merotasinya sebagai
  bagian redeploy ini.

## 2. Topologi proses dan anggaran koneksi

`infra/ecosystem.config.cjs` menjalankan:

| Proses | Mode | Jumlah | Pool DB | Fungsi |
| --- | --- | --- | --- | --- |
| `arena-api` | cluster | 3 | 12 utama + 4 auth per proses | HTTP API |
| `arena-finalization` | fork | 1 | 6 | Scanner MySQL + BullMQ, konkurensi 4 |
| `arena-waiting` | fork | 1 | 4 | Pelepas FIFO ruang tunggu |

Total koneksi aplikasi maksimum: `3 × (12 + 4) + 6 + 4 = 58`. Pool auth dibuat
lazy, jadi worker finalization/waiting tidak membuka koneksi auth yang tidak
dipakai. Sisakan headroom untuk migrator, admin, dan layanan lain di
`max_connections` MySQL (contoh `infra/mysql-16gb.cnf.example`: 100).

Rolling reload dapat membuka koneksi tambahan sementara. Jangan menaikkan
`DB_POOL_SIZE`/`AUTH_DB_POOL_SIZE` sebelum mengukur pool wait, lock MySQL, dan
p95 latency.

## 3. Pre-flight dan backup

```bash
cd /srv/repos/portal-data-man
git status --short                 # harus bersih; simpan perubahan lokal terpisah
export ARENA_PREVIOUS_COMMIT="$(git rev-parse HEAD)"
export ARENA_BACKUP_DIR="$HOME/arena-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ARENA_BACKUP_DIR"
chmod 700 "$ARENA_BACKUP_DIR"
printf '%s\n' "$ARENA_PREVIOUS_COMMIT" > "$ARENA_BACKUP_DIR/previous-commit.txt"

export ARENA_DB='arena'
mysql -u arena_migrator -p "$ARENA_DB" -e \
  "SELECT COUNT(*) active_attempts FROM exam_attempts WHERE status='IN_PROGRESS';"
mysqldump -u arena_migrator -p --single-transaction --routines --triggers \
  "$ARENA_DB" > "$ARENA_BACKUP_DIR/database.sql"
test -s "$ARENA_BACKUP_DIR/database.sql"
chmod 600 "$ARENA_BACKUP_DIR/database.sql"

cp -a arena/apps/web/dist "$ARENA_BACKUP_DIR/web-dist"
tar -czf "$ARENA_BACKUP_DIR/question-images.tar.gz" \
  -C /var/lib/arena question-images
pm2 status
```

Uji bahwa dump dapat dibaca (mis. restore ke database scratch) sebelum
melanjutkan. Catat versi Node/MySQL/Redis, lokasi vhost Nginx, dan output
`pm2 status`. Jangan membagikan dump atau konfigurasi yang memuat kredensial.

## 4. Ambil source dan build

```bash
cd /srv/repos/portal-data-man
git pull --ff-only origin main
git log -1 --oneline
cd arena
node --version                     # wajib >= 22
npm ci
npm run build                      # API + web harus lulus
ls apps/api/dist/server.js \
   apps/api/dist/finalization-worker.js \
   apps/api/dist/waiting-worker.js \
   apps/web/dist/index.html
```

Simpan aset hash lama agar browser yang masih membuka halaman lama tidak rusak:

```bash
cp -an "$ARENA_BACKUP_DIR/web-dist/assets/." apps/web/dist/assets/
```

Jangan melanjutkan bila install/build gagal. Jangan mengubah lockfile di VPS
atau mematikan verifikasi TLS untuk “memperbaiki” build.

## 5. Migrasi database

Periksa migrasi yang sudah ada:

```bash
mysql -u arena_migrator -p "$ARENA_DB" -e \
  "SELECT * FROM schema_migrations ORDER BY version;" 2>/dev/null || \
  mysql -u arena_migrator -p "$ARENA_DB" -e "SHOW TABLES LIKE '%migration%';"
```

Terapkan hanya migrasi yang belum ada, berurutan. Semua migrasi di bawah
idempotent dan aditif; tetap backup sebelum DDL.

### 5a. Migrasi 014 — kapasitas sesi

```bash
mysql -u arena_migrator -p "$ARENA_DB" < database/migrations/014_session_capacity.sql
mysql -u arena_migrator -p "$ARENA_DB" -e \
  "SHOW COLUMNS FROM exam_attempts LIKE 'termination_action'; \
   SHOW INDEX FROM exam_attempts WHERE Key_name='idx_arena_attempt_finalization';"
```

014 menambah keputusan terminasi dan indeks finalisasi. Attempt `TERMINATED`
lama tanpa hasil ditandai **LOCK** secara konservatif. Tinjau lewat admin;
jangan bulk unlock. Hasil yang sudah ada tidak dihapus.

### 5b. Migrasi 015 — revision sumber soal

```bash
mysql -u arena_migrator -p "$ARENA_DB" < database/migrations/015_exam_source_revision.sql
mysql -u arena_migrator -p "$ARENA_DB" -e \
  "SHOW COLUMNS FROM exams LIKE 'source_revision'; \
   SELECT TRIGGER_NAME,EVENT_MANIPULATION FROM information_schema.triggers \
   WHERE trigger_schema=DATABASE();"
```

015 menambah `exams.source_revision` dan tiga trigger di `questions`
(INSERT/UPDATE/DELETE) yang menaikkan revision dalam transaksi yang sama.
Cache soal Redis memakai revision ini sebagai sumber kebenaran; Redis restart
tidak pernah menyajikan soal stale.

Catatan trigger:

- Bila binlog aktif, pembuatan trigger membutuhkan
  `log_bin_trust_function_creators=ON` atau hak SUPER. Bila user migrator tidak
  punya SUPER, set sementara lewat sesi privileged lalu kembalikan:
  ```bash
  mysql -u root -p -e "SET GLOBAL log_bin_trust_function_creators=ON;"
  mysql -u arena_migrator -p "$ARENA_DB" < database/migrations/015_exam_source_revision.sql
  mysql -u root -p -e "SET GLOBAL log_bin_trust_function_creators=OFF;"
  ```
- Jangan memutasi `questions` sambil membaca/memutasi `exams` dalam statement
  yang sama (MySQL error 1442). Semua jalur aplikasi memakai literal `exam_id`.
- Trigger UPDATE menangani perpindahan `exam_id` dengan menaikkan revision
  kedua exam dalam satu statement.

Rollback 015 (hanya bila kode yang memakai revision sudah dilepas):
`database/rollbacks/015_exam_source_revision.sql`.

### 5c. Migrasi 016 — submission durable (fitur belum aktif)

```bash
mysql -u arena_migrator -p "$ARENA_DB" < database/migrations/016_exam_submissions.sql
mysql -u arena_migrator -p "$ARENA_DB" -e \
  "SHOW COLUMNS FROM exam_submissions; \
   SHOW COLUMNS FROM exam_attempts LIKE 'submitted_at';"
```

016 menambah tabel `exam_submissions` dan kolom `exam_attempts.submitted_at`.
**`SUBMIT_ASYNC` tetap `off` di production**; `/submit` memakai jalur sinkron
lama. Kode baru sudah punya fallback bila tabel/kolom belum ada, tetapi tetap
terapkan migrasi sebelum restart.

Rollback 016 hanya setelah kode baru dilepas dan tidak ada submission
`RECEIVED/PROCESSING`:

```bash
mysql -u arena_migrator -p "$ARENA_DB" < database/rollbacks/016_exam_submissions.sql
```

## 6. Environment

PM2 tidak membaca `.env` otomatis. Muat `.env` lewat Node seperti pada §8.
Pertahankan credential yang sudah benar dan jangan mencetak nilainya ke log.

### 6a. Matriks environment production

| Variabel | Nilai produksi | Catatan |
| --- | --- | --- |
| `NODE_ENV` | `production` | Cookie `Secure`, error tanpa stack |
| `HOST` / `PORT` | `0.0.0.0` / `3001` | Di belakang Nginx |
| `LOG_LEVEL` | `warn` | Naikkan sementara hanya saat investigasi |
| `TRUST_PROXY` | `true` bila hanya di belakang proxy tepercaya | Jangan percaya header forwarded sembarang |
| `DATABASE_URL` | `mysql://.../arena` | Pool utama ujian/operasional |
| `DB_POOL_SIZE` | `12` per proses API | Finalizer 6, waiting 4 |
| `DB_QUEUE_LIMIT` | `240` per proses API | Penuh → 503 + `Retry-After` |
| `AUTH_DB_POOL_SIZE` | `4` per proses API | **Tahap 4**: bulkhead login |
| `AUTH_DB_QUEUE_LIMIT` | `240` per proses API | Antrean pool auth |
| `DB_CONNECT_TIMEOUT_MS` | `10000` | Batas buka koneksi TCP, bukan antre pool |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Privat/loopback, AOF, noeviction |
| `REDIS_COMMAND_TIMEOUT_MS` | `1000` | |
| `EXAM_QUESTION_SOURCE_TTL_MS` | `2000` | Cache sumber lokal |
| `EXAM_QUESTION_REDIS_TTL_MS` | `2000`–`3600000` | Production profile memakai 2000; TTL hanya pembersih |
| `EXAM_QUESTION_PREWARM` | `on` | `off` mematikan trigger pre-warm |
| `EXAM_QUESTION_PREWARM_LOCK_MS` | `30000` | Anti-stampede |
| `PASSWORD_VERIFY_WORKERS` | `1` per proses API | 3 worker bcrypt untuk 4 vCPU |
| `PASSWORD_VERIFY_QUEUE_LIMIT` | `5000` | |
| `PASSWORD_VERIFY_CONCURRENCY_PER_WORKER` | `4` | |
| `WAITING_BATCH_SIZE` | `300` | |
| `WAITING_BATCH_INTERVAL_MS` | `10000` | |
| `WAITING_HEARTBEAT_TIMEOUT_MS` | `90000` | |
| `WAITING_CLAIM_TIMEOUT_MS` | `60000` | **Tahap 3 D7**; klien claim berjitter ≤8 dtk |
| `WAITING_WORKER_ENABLED` | `false` di proses API | Worker FIFO terpisah |
| `WAITING_WORKER_TICK_MS` | `1000` | |
| `ATTEMPT_FINALIZER_ENABLED` | `false` di proses API | Finalizer terpisah |
| `ATTEMPT_FINALIZER_INTERVAL_MS` | `30000` | |
| `ATTEMPT_FINALIZER_BATCH_SIZE` | `50` | |
| `FINALIZATION_CONCURRENCY` | `4` | Hanya worker finalization |
| `SUBMIT_ASYNC` | `off` | **Jangan aktifkan di production** |
| `SUBMIT_LEASE_MS` | `60000` | Lease klaim worker |
| `SUBMIT_LEASE_MAX_ATTEMPTS` | `5` | |
| `ARENA_LOGIN_DIAGNOSTICS` | `false` | Aktifkan sementara saat uji login; tanpa NISN/PIN |
| `ARENA_LOAD_DIAGNOSTICS` | `false` | **Tahap 3 D8**; log agregat claim/submit/result/SSE |
| `ARENA_EXAM_DIAGNOSTICS` | `false` | Log agregat ujian |
| `AUTH_TOKEN_SECRET` | secret ≥32 karakter | Jangan rotasi saat redeploy |
| `PIN_ENCRYPTION_KEY` | secret ≥32 karakter, berbeda | Backup terpisah; jangan rotasi |
| `ARENA_UPLOAD_DIR` | `/var/lib/arena/question-images` | Backup bersama database |
| `SETUP_TOKEN` | token sekali pakai | Kosongkan/rotasi setelah setup |
| `PORTAL_DATA_*`, `OIDC_*`, `ARENA_WEB_URL` | sesuai sekolah | Jangan ubah tanpa koordinasi SSO |

Nilai di atas mengikuti `infra/ecosystem.config.cjs` dan `.env.example`.
`DB_QUEUE_LIMIT=10000` di `.env.example` adalah default lokal; production
memakai 240 agar antrean tidak tumbuh tanpa batas.

### 6b. Redis dan MySQL

- Redis harus privat, AOF `everysec`, `maxmemory-policy noeviction`. Cache soal
  berisi kunci jawaban untuk kebutuhan server; jangan diekspos.
- Gabungkan `infra/redis-capacity.conf.example` dan
  `infra/mysql-16gb.cnf.example` dengan konfigurasi yang ada. Jangan mengganti
  seluruh file, ACL, atau password.
- Restart Redis/MySQL hanya pada jendela maintenance dan verifikasi koneksi.
- Jangan membuka port MySQL, Redis, atau API ke internet.

## 7. Nginx, sysctl, dan Cloudflare

1. Pasang directive `infra/nginx-main.conf` pada konteks `main`/`events`,
   `infra/nginx-http.conf` pada `http`, dan `infra/nginx-server.conf` pada server
   block Arena. Gabungkan `infra/nginx-static.conf` untuk `/assets/` dan HTML.
   Jangan menambah location duplikat; sesuaikan yang sudah ada.
2. Pertahankan proxy `/api`, `/auth`, `/health`, serta konfigurasi SSE
   (`proxy_buffering off`, timeout memadai) pada lokasi ujian.
3. Tinjau `infra/99-arena.conf`, salin ke `/etc/sysctl.d/99-arena.conf`, lalu
   `sysctl --system`. Pasang `infra/arena.service.d/limits.conf` sebagai
   drop-in systemd, `systemctl daemon-reload`, restart pada maintenance, dan
   periksa `ulimit -n`.
4. Cloudflare: DNS `arena` **Proxied**, SSL/TLS **Full (strict)**, origin valid.
   Gabungkan dua Cache Rule dari `infra/cloudflare-cache-rules.json`. Cache
   hanya `/assets/` untuk GET/HEAD. Letakkan bypass dinamis sesudah rule aset.
   Jangan memakai Cache Everything atau challenge interaktif pada API ujian.
5. Verifikasi:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -sSI https://arena.man1palembang.sch.id/ | head
```

Aset berulang harus `CF-Cache-Status: HIT`. Respons API terautentikasi harus
`no-store` dan tidak HIT, termasuk untuk dua siswa berbeda. Jangan menyalin
cookie/token peserta ke tiket atau log.

## 8. Jalankan PM2

```bash
cd /srv/repos/portal-data-man/arena
node --env-file=.env --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process';
const result = spawnSync('pm2', ['startOrReload', 'infra/ecosystem.config.cjs', '--update-env'], {
  env: { ...process.env, ARENA_DIR: process.cwd() }, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
NODE
pm2 status
pm2 logs arena-api --lines 50 --nostream
pm2 logs arena-finalization --lines 50 --nostream
pm2 logs arena-waiting --lines 50 --nostream
```

Jangan hanya reload `arena-api`: tanpa kedua worker, antrean FIFO dan
finalisasi latar belakang tidak berjalan. Pastikan tidak ada worker duplikat
dari systemd/cron/PM2 dengan nama lain. Setelah semua verifikasi lulus,
`pm2 save`.

## 9. Verifikasi sebelum membuka sesi

```bash
curl -fsS http://127.0.0.1:3001/health/live
curl -fsS http://127.0.0.1:3001/health/ready
pm2 status
```

`/health/live` menampilkan event-loop delay dan statistik verifier;
`/health/ready` memeriksa MySQL dan status Redis. Health API saja tidak
membuktikan worker berjalan.

Uji dengan akun/ujian dummy:

1. **Login**: 2–3 akun dummy login. Request pertama sengaja tertunda 0–6 detik
   (phase NISN + random) — ini normal. Saat server 503/429, klien retry dengan
   backoff penuh dan menghormati `Retry-After`.
2. **Ruang tunggu**: join → ADMITTED → claim. Durasi mulai saat claim, bukan
   saat join. Claim tersebar ≤8 detik setelah admission.
3. **Autosave**: simpan beberapa jenis jawaban, tunggu status tersimpan,
   refresh dan cocokkan. Flush autosave tersebar 2,5–5,5 detik per siswa.
4. **Submit**: submit dua kali; hasil tetap satu dan nilainya konsisten.
   `/result` memakai backoff, bukan polling 2 detik tanpa jeda.
5. **Expiry**: biarkan attempt dummy kedaluwarsa sambil browser ditutup.
   Worker finalization harus membuat hasil setelah scanner berjalan.
6. **LOCK**: pada ambang 3, pelanggaran pertama/kedua tetap `IN_PROGRESS`,
   ketiga `TERMINATED`; hasil tidak muncul otomatis dan direct submit ditolak.
   Reset admin memulihkan sesi sesuai aturan waktu.
7. **SSE**: dashboard pengawas dan ruang tunggu menerima perubahan tanpa
   membanjiri semua klien (Tahap 3 D5).

SQL pemantauan read-only:

```sql
SELECT COUNT(*) expired_pending
FROM exam_attempts a
WHERE a.status='IN_PROGRESS' AND a.expires_at<=UTC_TIMESTAMP(3);

SELECT a.termination_action,COUNT(*) terminated_without_result
FROM exam_attempts a
WHERE a.status='TERMINATED'
  AND NOT EXISTS(SELECT 1 FROM exam_results r WHERE r.attempt_id=a.id)
GROUP BY a.termination_action;

SELECT status,COUNT(*) FROM exam_submissions GROUP BY status;
```

`LOCK` tanpa hasil memang disengaja. `AUTO_SUBMIT` tanpa hasil yang menumpuk
atau submission `RECEIVED/PROCESSING` yang lama perlu investigasi worker.

## 10. Tuning Tahap 3 dan Tahap 4

Semua perilaku di bawah aktif otomatis; tidak ada flag tambahan kecuali
diagnostik.

| Perilaku | Default | Batas aman |
| --- | --- | --- |
| Jitter claim setelah ADMITTED | 0..min(`WAITING_BATCH_INTERVAL_MS`, 8000) ms | Jauh di bawah claim timeout 60 dtk |
| Jitter auto-submit saat waktu habis | 0..2000 ms | Tetap dianggap finalisasi setelah expiry |
| Backoff poll `/result` | RECEIVED backoff + jitter; PROCESSING 2 dtk | Tidak menumpuk saat drain |
| Flush autosave | 2,5–5,5 dtk, phase stabil per siswa | Mengurangi burst 300 siswa |
| `waiting.finish` | Setelah response submit | Tidak lagi di jalur kritis |
| SSE | Dirty per siswa, bukan seluruh exam | Beban linear turun |
| Claim timeout | 60 dtk | Cukup untuk jitter ≤8 dtk |
| Login pertama | Phase NISN (0–2,999 dtk) + random 0–2,999 dtk | 1.200 siswa tersebar ~6 dtk |
| Retry login | 1/2/4/8/10 dtk full jitter, lantai 500 ms, maks 8 percobaan | Menghormati `Retry-After` |
| Pool auth login | 4 koneksi/proses, antrean 240 | Terpisah dari pool ujian |

`ARENA_LOAD_DIAGNOSTICS=true` menulis log `load-shape diagnostic window`
(agregat, tanpa NISN) setiap 60 detik. Aktifkan sementara saat staging atau
investigasi, lalu kembalikan `false`. `ARENA_LOGIN_DIAGNOSTICS=true` melakukan
hal serupa untuk login.

Jangan menaikkan `WAITING_BATCH_SIZE` atau menurunkan interval batch hanya
berdasarkan jumlah request. Ukur p95 claim, pool wait, CPU, dan error 503.

## 11. Aktivasi bertahap submit asinkron (staging saja)

Production tetap `SUBMIT_ASYNC=off`. Bila ingin menguji Tahap 2 di staging:

1. Pastikan migrasi 016 sudah diterapkan dan worker finalization berjalan.
2. Set `SUBMIT_ASYNC=on` **hanya pada environment staging** dan restart proses
   API + worker.
3. Jalankan rehearsal: submit massal, matikan worker di tengah drain, restart,
   dan pastikan submission `RECEIVED/PROCESSING` selesai tanpa duplikasi.
4. Periksa invariant: satu hasil per attempt, tidak ada jawaban hilang, dan
   submission `SKIPPED` hanya karena lease habis.
5. Kembalikan `SUBMIT_ASYNC=off` bila rehearsal selesai, kecuali staging memang
   didedikasikan untuk uji async.

Runbook lengkap: [submission-async.md](../ops/submission-async.md).

## 12. Rollback

Jika build/migrasi gagal sebelum restart: hentikan deploy, pertahankan proses
lama, dan jangan menjalankan kode baru tanpa migrasi yang diperlukan.

Jika rilis sudah aktif dan harus rollback:

1. Tutup admission baru dan masuk maintenance; koordinasikan attempt aktif.
2. `pm2 stop arena-finalization arena-waiting` bila worker baru bermasalah.
3. Baca SHA dari `previous-commit.txt`, checkout revisi tersebut, lalu
   `npm ci && npm run build` **saat maintenance**.
4. Jangan restore dump database yang menimpa transaksi baru. Kolom/tabel
   migrasi 014–016 tetap dipertahankan; rollback kode harus tetap kompatibel
   atau layanan tetap maintenance sampai hotfix tersedia.
5. Kode sebelum rilis kapasitas mengabaikan `termination_action` dan dapat
   menilai attempt LOCK. Jangan membuka layanan dengan kode lama tanpa
   perlindungan LOCK.
6. Hapus entri PM2 worker baru hanya bila yakin tidak dipakai. `startOrReload`
   ecosystem lama tidak menghapus proses yang tidak ada di file.
7. Pulihkan konfigurasi Nginx/Cloudflare hanya untuk perubahan ARENA yang
   perlu dibatalkan, lalu verifikasi ulang.

## 13. Bukti pengujian dan batasnya

- Test API: 208 test (199 lulus, 0 gagal, 9 skip yang membutuhkan DB/Redis
  terpisah) setelah penambahan test bulkhead auth.
- Test web: 6 test helper load-shape + 4 test timeout/`Retry-After` lulus.
- Build API dan web lulus.
- Load test tidak dijalankan pada Tahap 3/4 ini. Angka kapasitas di
  [capacity-1200.md](../perf/capacity-1200.md) adalah benchmark lokal, bukan
  SLA VPS 16 GB.
- Sebelum ujian production, rehearsal harus mencakup 1.200 login/admission,
  putus-sambung jaringan, dashboard pengawas, dan durasi ujian penuh di staging.
- Rilis ini bukan pernyataan audit keamanan selesai.

## 14. Referensi

- [production-redeploy.md](production-redeploy.md) — panduan rilis kapasitas awal
- [staging-vps.md](staging-vps.md) — latar deployment staging
- [submission-async.md](../ops/submission-async.md) — runbook submit asinkron
- [waiting-room.md](../ops/waiting-room.md) — perilaku ruang tunggu
- [tahap3-load-distribution-plan.md](../ops/tahap3-load-distribution-plan.md) — desain Tahap 3
- [capacity-1200.md](../perf/capacity-1200.md) — benchmark dan batas kapasitas

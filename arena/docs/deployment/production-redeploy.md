# Redeploy ARENA — kapasitas 1.200 siswa

Target: **arena.man1palembang.sch.id**, VPS **4 vCPU / RAM 16 GB / disk 120 GB**.
MySQL dan Redis berada pada VPS yang sama. Panduan memakai checkout
`/srv/repos/portal-data-man`; sesuaikan bila lokasi aktual berbeda. Jalankan npm
serta PM2 sebagai user aplikasi yang selama ini menjalankan ARENA, bukan root.

Rilis ini menambahkan migrasi **014**, finalizer BullMQ terpisah, worker FIFO
terpisah, optimasi Redis, dan konfigurasi CDN. API tetap menyimpan jawaban ke
MySQL sebelum mengembalikan sukses. Cloudflare dan VPS belum diubah oleh agent.

## 1. Persiapan dan backup

Lakukan saat tidak ada ujian aktif. Hentikan penerimaan peserta melalui panel
admin dan verifikasi tidak ada attempt IN_PROGRESS. Jangan menimpa `.env`,
secret, database, maupun `/var/lib/arena/question-images`.

```bash
cd /srv/repos/portal-data-man
# Harus bersih; simpan perubahan lokal secara terpisah jika ada.
git status --short
export ARENA_PREVIOUS_COMMIT="$(git rev-parse HEAD)"
export ARENA_BACKUP_DIR="$HOME/arena-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ARENA_BACKUP_DIR"
chmod 700 "$ARENA_BACKUP_DIR"
printf '%s\n' "$ARENA_PREVIOUS_COMMIT" > "$ARENA_BACKUP_DIR/previous-commit.txt"
# Sesuaikan nama database dan akun DB; password dimasukkan melalui prompt.
export ARENA_DB='arena'
mysql -u arena_migrator -p "$ARENA_DB" -e "SELECT COUNT(*) active_attempts FROM exam_attempts WHERE status='IN_PROGRESS';"
mysqldump -u arena_migrator -p --single-transaction --routines --triggers \
  "$ARENA_DB" > "$ARENA_BACKUP_DIR/database.sql"
test -s "$ARENA_BACKUP_DIR/database.sql"
chmod 600 "$ARENA_BACKUP_DIR/database.sql"
cp -a arena/apps/web/dist "$ARENA_BACKUP_DIR/web-dist"
# Jalankan dengan akun yang dapat membaca direktori upload.
tar -czf "$ARENA_BACKUP_DIR/question-images.tar.gz" -C /var/lib/arena question-images
pm2 status
```

Pastikan backup berhasil dan dapat dipulihkan. Catat commit sebelumnya, versi
Node/MySQL/Redis, serta lokasi vhost Nginx. Jangan membagikan dump atau keluaran
konfigurasi yang memuat kredensial. Sisakan ruang disk untuk backup, build,
Redis AOF, dan log; 120 GB bukan seluruhnya kapasitas data yang bebas digunakan.

## 2. Ambil source dan build

```bash
cd /srv/repos/portal-data-man
git pull --ff-only origin main
git log -1 --oneline
cd arena
node --version                         # Node 22+ wajib
npm ci
npm run build                         # API dan frontend keduanya harus lulus
node --test apps/api/tests/finalization-policy.test.mjs \
  apps/api/tests/violation-signals.test.mjs \
  apps/api/tests/violation-terminal.test.mjs \
  apps/api/tests/expired-finalizer.test.mjs \
  apps/api/tests/exam-batch-answer.test.mjs
ls apps/api/dist/server.js apps/api/dist/finalization-worker.js \
   apps/api/dist/waiting-worker.js apps/web/dist/index.html
# Simpan aset hash lama untuk browser yang masih membuka halaman lama.
cp -an "$ARENA_BACKUP_DIR/web-dist/assets/." apps/web/dist/assets/
```

Jangan melanjutkan bila install/build gagal. Jangan memperbaiki kegagalan dengan
mengubah lockfile di VPS atau mematikan verifikasi TLS. Build frontend lokal
pada sesi audit ini belum diverifikasi; langkah build lengkap di atas wajib.

## 3. Terapkan migrasi 014 sebelum restart proses

Periksa bahwa migrasi 001–013 sudah diterapkan. Bila tertinggal, tinjau dan
terapkan hanya migrasi yang belum ada. **Jangan menjalankan
`scripts/migrate-local.mjs` atau `npm run demo:migrate` di database production.**

```bash
cd /srv/repos/portal-data-man/arena
mysql -u arena_migrator -p "$ARENA_DB" < database/migrations/014_session_capacity.sql
mysql -u arena_migrator -p "$ARENA_DB" -e \
  "SHOW COLUMNS FROM exam_attempts LIKE 'termination_action'; SHOW INDEX FROM exam_attempts WHERE Key_name='idx_arena_attempt_finalization';"
```

014 menambah kolom keputusan terminasi dan indeks finalisasi. Migrasi dapat
diulang. Attempt TERMINATED lama yang belum mempunyai hasil ditandai **LOCK**
secara konservatif, karena keputusan historisnya tidak tersimpan. Tinjau kasus
itu melalui admin; jangan melakukan bulk unlock. Reset admin menghapus penanda
LOCK pada attempt yang dipulihkan. Hasil yang sudah ada tidak dihapus.

## 4. Environment, MySQL, dan Redis

Pertahankan credential yang sudah benar. Pastikan environment setiap proses
memuat DATABASE_URL, REDIS_URL, AUTH_TOKEN_SECRET, PIN_ENCRYPTION_KEY serta
konfigurasi OIDC/Portal Data yang sudah digunakan. Jangan merotasi key PIN atau
AUTH_TOKEN_SECRET sebagai bagian redeploy ini. Isi `.env` harus memakai format
dotenv yang dapat dibaca Node `--env-file`.

Untuk layanan pada VPS yang sama, gunakan alamat privat/loopback. Redis harus
**AOF aktif** dan **maxmemory-policy noeviction**. Jangan membuka port Redis,
MySQL, atau API ke internet. Contoh konfigurasi:

- `infra/redis-capacity.conf.example`: AOF everysec, batas memori 1 GB.
- `infra/mysql-16gb.cnf.example`: buffer pool 6 GB, max_connections 100,
  commit durable tetap aktif.

Gabungkan nilai dengan konfigurasi service yang sudah ada; jangan mengganti
seluruh konfigurasi Redis/MySQL atau ACL/password. Restart service hanya pada
jendela maintenance dan verifikasi koneksinya kembali. Sesuaikan alokasi jika
VPS juga menjalankan aplikasi lain. Jangan menjalankan CONFIG GET/CLI dengan
password yang kemudian disalin ke log atau chat.

Profil PM2 membatasi total koneksi aplikasi menjadi **46**: API 3×12,
finalizer 6, waiting worker 4. Rolling reload dapat membuka koneksi tambahan
sementara; sisakan headroom untuk migrator, admin, dan layanan lain.

## 5. Aktifkan API dan kedua worker

Ecosystem sekarang memuat:

| Proses | Jumlah | Fungsi |
| --- | --- | --- |
| arena-api | 3 | HTTP API; finalizer/FIFO internal dimatikan |
| arena-finalization | 1 | Scanner MySQL + BullMQ, konkurensi 4 |
| arena-waiting | 1 | Melepas peserta FIFO |

PM2 tidak otomatis membaca `.env`. Perintah berikut memuatnya melalui Node dan
meneruskannya ke PM2 tanpa mencetak nilai. Bila server memakai secret manager,
gunakan mekanisme injeksi yang sama untuk **ketiga nama proses**. Pastikan shell
deploy tidak mengekspor credential lama yang menimpa `.env`.

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

Jangan hanya reload arena-api: tanpa kedua worker, antrean masuk dan finalisasi
latar belakang tidak berjalan. Pastikan tidak ada worker lama yang dijalankan
oleh systemd/cron/PM2 dengan nama lain. Hentikan hanya worker duplikat yang sudah
diidentifikasi. Setelah semua verifikasi lulus, jalankan `pm2 save`.

## 6. Nginx dan Cloudflare

Pada vhost `arena.man1palembang.sch.id`, document root tetap menunjuk ke
`/srv/repos/portal-data-man/arena/apps/web/dist`. Gabungkan blok di
`infra/nginx-static.conf` dengan vhost aktual; bila sudah ada location `/assets/`
atau `/index.html`, sesuaikan blok itu, jangan menambah duplikat. Pertahankan
proxy `/api`, `/auth`, `/health`, serta konfigurasi SSE pada lokasi ujian.

```bash
sudo nginx -t
# Hanya lanjut bila nginx -t lulus.
sudo systemctl reload nginx
```

Di dashboard Cloudflare untuk zona `man1palembang.sch.id`:

1. Record DNS `arena` mengarah ke IP VPS yang benar dan berstatus **Proxied**.
2. SSL/TLS **Full (strict)**, dengan sertifikat origin yang valid.
3. Tambahkan/merge dua Cache Rules dari `infra/cloudflare-cache-rules.json`.
   Ekspresinya sudah memakai hostname production. Cache hanya `/assets/` untuk
   GET/HEAD, mengikuti Cache-Control origin. Letakkan bypass dinamis sesudahnya
   dan periksa rule lain agar tidak menimpa bypass itu.
4. Jangan memakai Cache Everything atau challenge interaktif pada API ujian.
   API, auth, HTML, dan gambar soal privat tidak boleh mendapat cache hit.
   Pertahankan aturan zona lain yang tidak terkait ARENA.
5. Jangan purge seluruh aset saat ujian. Bila diperlukan, purge URL HTML yang
   berubah; nama file build baru sudah memiliki hash.

Verifikasi dengan DevTools/curl: permintaan berulang terhadap satu URL JS/CSS
build harus beralih ke `CF-Cache-Status: HIT`. Respons API terautentikasi harus
memuat no-store dan tidak HIT, termasuk ketika diakses dua siswa berbeda.
Jangan menyalin cookie/token peserta ke tiket atau log.

## 7. Verifikasi sebelum membuka sesi

```bash
curl -fsS http://127.0.0.1:3001/health/live
curl -fsS http://127.0.0.1:3001/health/ready
curl -sSI https://arena.man1palembang.sch.id/
pm2 status
```

Health API saja tidak membuktikan worker berjalan. Dengan akun/ujian dummy:

- Join waiting room → admitted → claim; durasi mulai saat claim.
- Simpan beberapa jenis jawaban, tunggu status tersimpan, refresh dan cocokkan.
- Submit dua kali; hasil tetap satu dan nilainya konsisten.
- Biarkan attempt dummy kedaluwarsa sambil browser ditutup; worker harus membuat
  hasil setelah scanner berjalan (interval normal 10 detik, ditambah antrean).
- Kebijakan LOCK: pada ambang 3, pelanggaran pertama/kedua tetap IN_PROGRESS,
  ketiga TERMINATED; hasil tidak muncul otomatis dan direct submit ditolak.
  Reset oleh admin memulihkan sesi sesuai aturan waktu yang berlaku.
- Pantau error Redis, retry BullMQ, pool MySQL, CPU, RAM, disk, dan log.

SQL pemantauan backlog (read-only):

```sql
SELECT COUNT(*) expired_pending
FROM exam_attempts a
WHERE a.status='IN_PROGRESS' AND a.expires_at<=UTC_TIMESTAMP(3);
SELECT a.termination_action,COUNT(*) terminated_without_result
FROM exam_attempts a
WHERE a.status='TERMINATED'
  AND NOT EXISTS(SELECT 1 FROM exam_results r WHERE r.attempt_id=a.id)
GROUP BY a.termination_action;
```

LOCK tanpa hasil memang disengaja. AUTO_SUBMIT tanpa hasil yang terus menumpuk
perlu investigasi worker. Setelah lolos, `pm2 save` dan buka antrean kembali.

## 8. Rollback / kegagalan deployment

Jika build atau migrasi gagal sebelum restart, hentikan langkah deploy dan
pertahankan proses lama selama investigasi; jangan menjalankan kode baru tanpa
014. Jika ada kemungkinan proses lama restart, kembalikan artefak build yang
sesuai sebelum mengizinkannya menerima trafik lagi.

Jika rilis sudah aktif dan perlu rollback:

1. Tutup admission baru, gunakan maintenance, dan koordinasikan attempt aktif.
2. Hentikan kedua worker baru: `pm2 stop arena-finalization arena-waiting`.
3. Baca SHA dari `previous-commit.txt`, checkout revisi tersebut, lalu install dan
   build ulang **saat maintenance**. Jangan reset/hapus data database.
4. Jangan langsung membuka layanan dengan kode lama: kode sebelum rilis ini
   mengabaikan termination_action dan dapat menilai attempt LOCK. Rollback aman
   memerlukan versi yang mempertahankan perlindungan LOCK, atau tetap maintenance
   sampai hotfix tersedia. Mematikan finalizer saja tidak menutup direct submit.
5. Hapus entri worker PM2 baru hanya jika rollback telah dipastikan tidak memakai
   worker tersebut; startOrReload ecosystem lama tidak otomatis menghapusnya.
6. Pertahankan kolom/indeks 014 dan semua jawaban/hasil. Jangan restore backup
   database menimpa transaksi baru. Pulihkan konfigurasi Nginx/Cloudflare hanya
   untuk perubahan ARENA yang memang perlu dibatalkan, lalu verifikasi ulang.

## 9. Bukti pengujian dan batasnya

Lihat [laporan kapasitas](../perf/capacity-1200.md) dan JSON benchmark terkait.
Uji lokal 1.200 siswa dengan tiga proses API dan interval batch 3 detik:
autosave p95 38 ms, submit p95 748 ms, 12.000 jawaban serta 1.200 hasil
terverifikasi. Burst langsung memiliki autosave p95 837 ms. Executor lokal
memiliki batas RAM 32 GB, sehingga angka itu bukan SLA untuk VPS 16 GB.

Sebelum ujian produksi, rehearsal harus mencakup 1.200 login/admission,
putus-sambung jaringan, dashboard pengawas, dan durasi ujian penuh. Jangan
menjalankan skrip load test pada data peserta production. Dua tes reset lama
masih gagal; temuan pencabutan sesi staf dan pengikatan SSO ke browser juga
masih terbuka. Rilis kapasitas ini bukan pernyataan audit keamanan selesai.

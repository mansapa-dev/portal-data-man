# PANDUAN LENGKAP REDEPLOY PRODUCTION CBT ARENA (1.200 SISWA CONCURRENT)
**Target Infrastruktur:** 1 VPS Mandiri (4 vCPU, 15–16 GB RAM, Ubuntu 22.04 / 24.04 LTS, SSD/NVMe)  
**Dokumen:** Standard Operating Procedure (SOP) & Runbook Rilis Langsung ke Production  
**Tanggal Rilis:** November 2026

---

## 1. RINGKASAN ARSITEKTUR & TOPOLOGI SISTEM

Arsitektur yang dipasang pada 1 VPS fisik/virtual ini dirancang untuk mendistribusikan beban **1.200 siswa aktif secara bersamaan** (50 soal/siswa, autosave reguler, submit storm, dan image loading):

```text
                                INTERNET
                                   |
                                   v
                         CLOUDFLARE (SSL / CDN)
                                   |
                                   v
                             NGINX (:443)
      +----------------------------+----------------------------+
      | (Static /assets & SPA)     | (Least_conn Balancing)     | (Direct Static Images)
      v                            v                            v
 apps/web/dist              upstream cbt_api           /srv/arena/storage/...
 Immutable 1-Year Cache    (keepalive 128)             Regex 64-hex bypass Node
                                   |
        +--------------------------+--------------------------+
        |                          |                          |
        v                          v                          v
  arena-api-1                arena-api-2                arena-api-3
 127.0.0.1:3001             127.0.0.1:3002             127.0.0.1:3003
 (Port 3001 - Fork)         (Port 3002 - Fork)         (Port 3003 - Fork)
 - 2 Bcrypt Workers         - 2 Bcrypt Workers         - 2 Bcrypt Workers
 - SUBMIT_ASYNC: on         - SUBMIT_ASYNC: on         - SUBMIT_ASYNC: on
 - DB Pool: 12 + Auth 4     - DB Pool: 12 + Auth 4     - DB Pool: 12 + Auth 4
        |                          |                          |
        +--------------------------+--------------------------+
                                   |
             +---------------------+---------------------+
             |                                           |
             v                                           v
      MySQL 8.0 (InnoDB)                               Redis
    - max_connections: 300                     - BullMQ: finalization
    - innodb_buffer_pool_size: 6G              - Waiting Room Lua state
    - trx_commit: 1 (ACID durable)             - Shared Rate Limiter
    - Managed App Pool: 58 conn                - Question Revision Cache
             |                                           |
             +---------------------+---------------------+
                                   |
                     +-------------+-------------+
                     |                           |
                     v                           v
           arena-finalization              arena-waiting
             (BullMQ Worker)              (Waiting Worker)
         - 4 Scoring Concurrency       - 1-second batch tick
         - MySQL Advisory Lock         - Lua Atomic Admission
         - ExpiredAttemptFinalizer
```

---

## 2. TAHAP 0: PRE-FLIGHT CHECKLIST & BACKUP LENGKAP

> [!IMPORTANT]
> Lakukan seluruh prosedur saat **TIDAK ADA UJIAN AKTIF**. Pastikan jendela ujian ditutup sementara melalui panel proctor/admin.

### 2.1. Cek Sesi Aktif di Database
Masuk ke terminal server dan periksa apakah masih ada siswa yang sedang mengerjakan ujian:
```bash
mysql -u root -p -e "SELECT COUNT(*) AS active_attempts FROM arena.exam_attempts WHERE status='IN_PROGRESS';"
```
*Pastikan hasilnya `0` sebelum melanjutkan.*

### 2.2. Eksekusi Backup Penuh
Buat direktori backup khusus dengan timestamp:
```bash
export ARENA_BACKUP_DIR="$HOME/arena-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ARENA_BACKUP_DIR"
chmod 700 "$ARENA_BACKUP_DIR"
cd /srv/repos/portal-data-man

# 1. Simpan commit hash saat ini
git rev-parse HEAD > "$ARENA_BACKUP_DIR/git-commit-before.txt"

# 2. Dump Database MySQL (Durable Snapshot)
mysqldump -u root -p --single-transaction --routines --triggers --quick arena > "$ARENA_BACKUP_DIR/arena_db_pre_deploy.sql"
test -s "$ARENA_BACKUP_DIR/arena_db_pre_deploy.sql" && echo "Database backup: SUCCESS"

# 3. Backup file .env saat ini
cp arena/.env "$ARENA_BACKUP_DIR/.env.backup"

# 4. Backup direktori gambar soal
tar -czf "$ARENA_BACKUP_DIR/question-images-backup.tar.gz" -C /srv/arena/storage question-images 2>/dev/null || \
tar -czf "$ARENA_BACKUP_DIR/question-images-backup.tar.gz" -C /var/lib/arena question-images 2>/dev/null || true

echo "Backup selesai di: $ARENA_BACKUP_DIR"
```

---

## 3. TAHAP 1: PULL CODE TERBARU & BUILD APLIKASI

Jalankan perintah ini sebagai user aplikasi yang mengelola repositori (misalnya `arena` atau user deployer non-root Anda):

```bash
cd /srv/repos/portal-data-man

# Pastikan working tree bersih
git status --short

# Tarik branch main terbaru
git fetch origin
git checkout main
git pull --ff-only origin main

# Masuk ke direktori arena
cd arena

# Pastikan Node.js versi 22+
node --version

# Install dependensi secara bersih (clean install)
npm ci

# Build backend API dan frontend Web
npm run build -w @arena/api
npm run build -w @arena/web
```

Verifikasi hasil build:
- Direktori `arena/apps/api/dist/server.js` harus ada dan terupdate.
- Direktori `arena/apps/api/dist/finalization-worker.js` harus ada.
- Direktori `arena/apps/api/dist/waiting-worker.js` harus ada.
- Direktori `arena/apps/web/dist/index.html` dan `arena/apps/web/dist/assets/` harus ada.

---

## 4. TAHAP 2: DATABASE MIGRATION (MIGRASI 016)

> [!CRITICAL]
> Mode `SUBMIT_ASYNC=on` membutuhkan tabel `exam_submissions` dan kolom `submitted_at` pada tabel `exam_attempts`. Jika belum terpasang, sistem akan fallback ke submit sinkron atau melempar error.

Terapkan migrasi 016 ke database production:
```bash
mysql -u root -p arena < database/migrations/016_exam_submissions.sql
```

Verifikasi keberadaan tabel dan kolom:
```bash
mysql -u root -p arena -e "
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='arena' AND TABLE_NAME='exam_submissions';
SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='arena' AND TABLE_NAME='exam_attempts' AND COLUMN_NAME='submitted_at';
"
```
*Output harus menampilkan `exam_submissions` dan `submitted_at`.*

---

## 5. TAHAP 3: KONFIGURASI ENVIRONMENT PRODUCTION (`arena/.env`)

Buka dan sesuaikan file `arena/.env` di server:
```bash
nano /srv/repos/portal-data-man/arena/.env
```

Pastikan variabel-variabel kunci berikut disetel sesuai parameter production 1.200 user:

```ini
# CORE CONFIG
HOST=0.0.0.0
LOG_LEVEL=warn
NODE_ENV=production
TRUST_PROXY=true

# DATABASE CONNECTION POOL (Bulkhead Pattern)
DATABASE_URL=mysql://arena_app:PASSWORD_DB_ANDA@127.0.0.1:3306/arena
DB_POOL_SIZE=12
DB_QUEUE_LIMIT=240
AUTH_DB_POOL_SIZE=4
AUTH_DB_QUEUE_LIMIT=240
DB_CONNECT_TIMEOUT_MS=10000

# REDIS CACHE & QUEUE
REDIS_URL=redis://127.0.0.1:6379
REDIS_COMMAND_TIMEOUT_MS=1000
EXAM_QUESTION_REDIS_TTL_MS=3600000
EXAM_QUESTION_PREWARM=on

# ASYNC SUBMISSION (WAJIB AKTIF)
SUBMIT_ASYNC=on
SUBMIT_LEASE_MS=60000
SUBMIT_LEASE_MAX_ATTEMPTS=5
FINALIZATION_CONCURRENCY=4

# BCRYPT WORKER TUNING (2 worker per proses x 3 proses = 6 worker thread)
PASSWORD_VERIFY_WORKERS=2
PASSWORD_VERIFY_QUEUE_LIMIT=5000
PASSWORD_VERIFY_QUEUE_TIMEOUT_MS=20000
PASSWORD_VERIFY_CONCURRENCY_PER_WORKER=1

# WAITING ROOM BATCH TUNING
WAITING_BATCH_SIZE=300
WAITING_BATCH_INTERVAL_MS=10000
WAITING_HEARTBEAT_TIMEOUT_MS=90000
WAITING_CLAIM_TIMEOUT_MS=60000
WAITING_WORKER_ENABLED=false
ATTEMPT_FINALIZER_ENABLED=false

# PERSISTENT STORAGE
ARENA_UPLOAD_DIR=/srv/arena/storage/question-images

# SECRETS (JANGAN DIUBAH DARI NILAI LAMA)
# AUTH_TOKEN_SECRET=...
# PIN_ENCRYPTION_KEY=...
```

---

## 6. TAHAP 4: TUNING SISTEM (MYSQL, REDIS, NGINX)

### 6.1. MySQL Configuration
Salin konfigurasi 16GB ke direktori MySQL conf.d:
```bash
sudo cp /srv/repos/portal-data-man/arena/infra/mysql-16gb.cnf.example /etc/mysql/mysql.conf.d/arena.cnf
```
Periksa isinya:
```ini
[mysqld]
innodb_buffer_pool_size=6G
max_connections=300
thread_cache_size=64
table_open_cache=4000
innodb_log_file_size=1G
innodb_flush_log_at_trx_commit=1
sync_binlog=1
slow_query_log=ON
long_query_time=0.5
```
Terapkan perubahan dan restart MySQL:
```bash
sudo systemctl restart mysql
# Verifikasi max_connections terpasang 300
mysql -u root -p -e "SHOW VARIABLES LIKE 'max_connections';"
```

### 6.2. Redis Configuration
Pastikan Redis mengaktifkan persistensi AOF dan memori aman:
```bash
sudo nano /etc/redis/redis.conf
```
Pastikan baris berikut aktif:
```ini
appendonly yes
appendfsync everysec
maxmemory-policy noeviction
```
Reload Redis jika ada perubahan:
```bash
sudo systemctl restart redis-server
redis-cli ping # Harus membalas PONG
```

### 6.3. Direktori Gambar Soal (Question Images)
Pastikan folder direktori upload gambar telah ada dan dapat dibaca oleh Nginx (`www-data`):
```bash
sudo mkdir -p /srv/arena/storage/question-images
sudo chown -R arena:www-data /srv/arena/storage/question-images
sudo chmod -R 755 /srv/arena/storage/question-images
```

### 6.4. Nginx Configuration
1. Pasang file upstream:
```bash
sudo cp /srv/repos/portal-data-man/arena/infra/nginx-http.conf /etc/nginx/conf.d/arena-upstream.conf
```

2. Pastikan file konfigurasi vhost website Arena Anda (misalnya `/etc/nginx/sites-available/arena.conf`) menyertakan:
   - Root direktori mengarah ke `apps/web/dist`
   - Include `nginx-server.conf`
   - Include `nginx-static.conf`

Contoh struktur blok server vhost lengkap:
```nginx
server {
    listen 80;
    server_name arena.man1palembang.sch.id;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name arena.man1palembang.sch.id;

    # SSL Certificates
    ssl_certificate /etc/letsencrypt/live/arena.man1palembang.sch.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/arena.man1palembang.sch.id/privkey.pem;

    root /srv/repos/portal-data-man/arena/apps/web/dist;
    index index.html;

    # Sertakan konfigurasi lokasi statis SPA
    include /srv/repos/portal-data-man/arena/infra/nginx-static.conf;

    # Sertakan konfigurasi routing API, SSE, Image Bypass, dan Health
    include /srv/repos/portal-data-man/arena/infra/nginx-server.conf;

    # Fallback SPA untuk React Router
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

3. Uji sintaks Nginx dan reload:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 7. TAHAP 5: JALANKAN PROSES APLIKASI (PM2)

> [!TIP]
> PM2 sekarang menggunakan mode **fork 3 instance** terpisah pada port 3001, 3002, dan 3003, ditambah worker finalisasi dan waiting room.

### 7.1. Bersihkan Proses Lama (Jika Ada)
Hentikan dan hapus konfigurasi PM2 lama:
```bash
pm2 delete all || true
```

### 7.2. Jalankan Konfigurasi Baru
Jalankan file ekosistem produksi yang telah direvisi:
```bash
cd /srv/repos/portal-data-man/arena
pm2 start infra/ecosystem.config.cjs
```

### 7.3. Simpan State PM2
Pastikan proses berjalan otomatis ketika server reboot:
```bash
pm2 save
pm2 startup
# Jalankan perintah 'sudo env PATH=...' jika diminta oleh output pm2 startup
```

### 7.4. Verifikasi Proses
Periksa status 5 aplikasi PM2:
```bash
pm2 list
```
*Tabel harus menampilkan 5 proses dalam status `online`:*
1. `arena-api-1` (port 3001)
2. `arena-api-2` (port 3002)
3. `arena-api-3` (port 3003)
4. `arena-finalization` (BullMQ scoring + Expired attempt finalizer)
5. `arena-waiting` (Waiting room ticket worker)

---

## 8. TAHAP 6: SMOKE TEST & POST-DEPLOYMENT VERIFICATION

Lakukan verifikasi bertahap dari terminal VPS:

### 8.1. Uji Fast Health Check Setiap Instance
```bash
curl -s http://127.0.0.1:3001/health
curl -s http://127.0.0.1:3002/health
curl -s http://127.0.0.1:3003/health
# Setiap curl harus mengembalikan: {"status":"ok"}
```

### 8.2. Uji Readiness Check Database & Redis
```bash
curl -s http://127.0.0.1:3001/ready
# Harus mengembalikan: {"status":"ok","database":"ok","redis":"ok"}
```

### 8.3. Uji Domain Publik Melalui Nginx
```bash
curl -I https://arena.man1palembang.sch.id/health
# Harus mengembalikan: HTTP/2 200 OK
```

### 8.4. Verifikasi Nginx Static Offload Gambar Soal
Pastikan Nginx melayani file gambar langsung tanpa masuk ke log Node.js:
```bash
# Cek header respons gambar soal (ganti dengan nama file gambar yang ada bila ada)
curl -I https://arena.man1palembang.sch.id/api/question-images/0000000000000000000000000000000000000000000000000000000000000000.png
# Harus mengembalikan 404 dari Nginx (bukan error Fastify 500) dengan header:
# Cache-Control: public, max-age=31536000, immutable
```

### 8.5. Cek Log Awal PM2
```bash
pm2 logs --lines 20
```
*Pastikan tidak ada pesan error `ER_NO_SUCH_TABLE`, uncaught exception, atau connection error.*

---

## 9. TAHAP 7: MONITORING REAL-TIME SELAMA SESI UJIAN

Gunakan perintah-perintah berikut saat 1.200 siswa mulai login dan mengerjakan ujian:

### 9.1. Monitor Beban Node & Memori
```bash
pm2 monit
```
*Pantau CPU dan memory masing-masing instance (normal: < 800MB per instance).*

### 9.2. Monitor Koneksi MySQL Real-Time
Buka sesi MySQL monitoring di terminal kedua:
```bash
mysql -u root -p -e "
SHOW STATUS WHERE Variable_name IN ('Threads_running', 'Threads_connected', 'Max_used_connections');
"
```
*Koneksi aktif (`Threads_running`) normalnya berkisar 2–15 query. `Threads_connected` tidak boleh mendekati 300.*

### 9.3. Monitor Antrean BullMQ di Redis
Cek status antrean finalisasi skor:
```bash
redis-cli hgetall "bull:finalization:meta"
```

### 9.4. Monitor Event Loop Delay & Bcrypt Stats
Akses metrik internal Fastify:
```bash
curl -s http://127.0.0.1:3001/health/live | jq .
```
*Pastikan `eventLoopDelayMs.p95` berada di bawah 50ms dan antrean `verifier.queueDepth` tidak stagnan.*

---

## 10. TAHAP 8: SOP ROLLBACK DARURAT (EMERGENCY ROLLBACK)

Jika terjadi kendala fatal yang tidak terduga pada aplikasi baru:

> [!CAUTION]
> **JANGAN PERNAH me-restore database dump jika siswa sudah mulai mengerjakan soal**, karena hal tersebut akan menghapus seluruh jawaban siswa yang baru masuk! Rollback hanya dilakukan pada level kode aplikasi.

Langkah rollback kode aplikasi:
```bash
cd /srv/repos/portal-data-man

# 1. Kembali ke commit sebelum deploy
export PREV_COMMIT=$(cat $ARENA_BACKUP_DIR/git-commit-before.txt)
git checkout $PREV_COMMIT

# 2. Re-build versi sebelumnya
cd arena
npm ci
npm run build -w @arena/api
npm run build -w @arena/web

# 3. Pulihkan .env lama (opsional jika perlu)
# cp $ARENA_BACKUP_DIR/.env.backup arena/.env

# 4. Restart PM2
pm2 restart all
pm2 logs --lines 30
```
Jika migrasi 016 perlu di-rollback (hanya jika tabel tidak digunakan):
```bash
mysql -u root -p arena < database/rollbacks/016_exam_submissions.sql
```
*Catatan: Rollback 016 hanya boleh dijalankan jika `SUBMIT_ASYNC` sudah disetel kembali ke `'off'`.*

---

## 11. CHECKLIST FINAL SEBELUM HARI H

- [ ] Migrasi 016 telah berhasil diterapkan di MySQL (`exam_submissions` dan `submitted_at` ada).
- [ ] MySQL `max_connections` bernilai minimal `300`.
- [ ] Nginx upstream `cbt_api` aktif dengan port 3001, 3002, 3003 dan `least_conn`.
- [ ] Nginx static offload untuk `/api/question-images/` telah diuji (`nginx -t` lolos).
- [ ] PM2 menjalankan 5 proses: `arena-api-1`, `arena-api-2`, `arena-api-3`, `arena-finalization`, `arena-waiting`.
- [ ] Variabel `SUBMIT_ASYNC=on` dan `PASSWORD_VERIFY_WORKERS=2` aktif.
- [ ] Backup pra-deploy tersimpan aman di direktori luar repositori.
- [ ] Siswa diarahkan login bertahap sesuai jadwal dengan token/PIN yang telah digenerate.


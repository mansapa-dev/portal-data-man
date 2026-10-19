# Deploy Arena ke VPS staging

Panduan ini menyiapkan Arena di `https://staging.arena.man1palembang.sch.id`. Ini panduan staging, bukan izin untuk mengubah VPS atau mengganti CBT. Arena harus memakai database dan service tersendiri.

## Yang harus diverifikasi sebelum mulai

Nilai berikut belum dibuktikan dari repository dan harus diperiksa langsung oleh pemilik VPS:

- OS dan versinya, akses `sudo`, kapasitas CPU/RAM/disk, serta kebijakan firewall.
- IP publik VPS dan pengelola DNS domain.
- Apakah Nginx sudah berjalan, konfigurasi vhost yang aktif, sertifikat TLS, dan domain lain yang berbagi VPS.
- Versi/engine MySQL yang tersedia, `max_connections`, mode SQL, serta beban database dari layanan lain.
- URL Portal Data yang tepat, issuer OIDC, dan credential client yang diizinkan untuk staging.
- Ruang disk dan jadwal backup yang disetujui.

Jangan menganggap server Portal Data, CBT, atau domain produksi sebagai sumber nilai di atas. Jangan menyalin `.env` atau credential dari aplikasi lain. Simpan hasil pemeriksaan server secara privat; keluaran `nginx -T` dan konfigurasi layanan bisa berisi rahasia.

## Rancangan staging

```text
Browser
  │ HTTPS :443
  ▼
Nginx ── static React/Vite dari apps/web/dist
  │ /api, /auth, /health
  ▼
Fastify 127.0.0.1:3001 ── MySQL database arena_staging
                         └─ /var/lib/arena/question-images
```

Jangan membuka port 3001, MySQL 3306, atau Redis 6379 ke internet. Jalankan satu proses API di belakang Nginx untuk staging; finalizer ujian berjalan di proses API. Beberapa replika memerlukan koordinasi rate limit dan finalizer yang belum disiapkan di sini.

## 1. DNS dan jaringan

1. Buat record `A` untuk `staging.arena.man1palembang.sch.id` ke IP publik VPS yang telah dikonfirmasi.
2. Buat record `AAAA` hanya jika VPS dan firewall benar-benar melayani IPv6.
3. Setelah DNS tersebar, periksa dari komputer admin:

   ```sh
   dig +short A staging.arena.man1palembang.sch.id
   dig +short AAAA staging.arena.man1palembang.sch.id
   ```

4. Izinkan SSH hanya dari alamat admin bila memungkinkan. Izinkan 80/443 sesuai kebutuhan sertifikat dan HTTPS. Jangan menambah aturan firewall sebelum memeriksa aturan yang sudah dipakai layanan lain.

## 2. Persiapan VPS

Perintah berikut mengasumsikan Debian/Ubuntu. Jika hasil verifikasi menunjukkan OS lain, gunakan prosedur paket OS tersebut. Pasang Node.js 22 atau lebih baru, npm, Nginx, MySQL yang disetujui, dan Certbot sesuai konfigurasi VPS. Repository mensyaratkan Node.js `>=22`.

Periksa sebelum memasang atau mengubah service bersama:

```sh
cat /etc/os-release
node --version
npm --version
nginx -v
mysql --version
free -h
df -h
nproc
```

Periksa versi server MySQL dengan akun admin database yang sesuai:

```sql
SELECT VERSION(), @@version_comment, @@sql_mode, @@max_connections;
```

Desain lokal belum membuktikan kompatibilitas dengan server staging. Uji seluruh migrasi pada database staging kosong dengan engine dan versi yang sama sebelum pilot.

Buat user OS khusus, direktori aplikasi, dan direktori data persisten. Contoh nama/path berikut adalah rancangan, sesuaikan setelah memeriksa standar VPS:

```sh
sudo adduser --system --group --home /opt/arena arena
sudo install -d -o arena -g arena -m 0750 /opt/arena/releases
sudo install -d -o arena -g arena -m 0750 /var/lib/arena/question-images
sudo install -d -o root -g arena -m 0750 /etc/arena
```

## 3. Siapkan artefak aplikasi

Deploy hanya revisi yang sudah ditinjau. Working tree saat penulisan panduan dapat berisi perubahan lokal dan file belum di-commit; tinjau semuanya lalu buat commit/release sebelum upload. Jangan kirim `arena/.env`, credential, `node_modules`, `.git`, database dump, atau hasil build lokal.

Pilih salah satu cara:

- **Git:** clone/fetch repository ke direktori release lalu checkout commit/tag yang disetujui.
- **Arsip dari checkout yang ditinjau:** dari direktori repository induk, buat arsip tanpa file lokal rahasia/build:

  ```sh
  tar -czf arena-staging.tar.gz \
    --exclude='arena/.git' \
    --exclude='arena/.env' \
    --exclude='arena/node_modules' \
    --exclude='arena/apps/*/node_modules' \
    --exclude='arena/apps/*/dist' \
    --exclude='arena/storage' \
    arena
  ```

  Salin arsip melalui SCP/SFTP ke direktori release yang baru. Jangan mengekstrak di atas release aktif.

Di direktori release pada VPS:

```sh
cd /opt/arena/releases/<release>
sudo chown -R arena:arena /opt/arena/releases/<release>
npm ci
npm run build
sudo ln -sfn /opt/arena/releases/<release> /opt/arena/current
```

Hasil frontend ada di `apps/web/dist`, API di `apps/api/dist`. Build mungkin butuh RAM/disk sementara; jangan jalankan build bersamaan dengan beban ujian tanpa jendela yang disetujui. Jangan menjalankan `npm run demo:seed` pada staging.

## 4. Buat database terisolasi

Buat database baru `arena_staging` pada MySQL yang sudah diverifikasi. Jangan menunjuk `DATABASE_URL` ke database CBT, Portal Data, atau Arena lain.

Pola hak akses yang disarankan:

- User migrasi hanya diberi hak DDL yang diperlukan pada `arena_staging.*`; gunakan untuk migrasi awal.
- User runtime Arena hanya diberi `SELECT`, `INSERT`, `UPDATE`, dan `DELETE` pada `arena_staging.*` setelah schema dibuat.
- Jangan berikan `GRANT OPTION`, hak global, atau akses jaringan dari luar VPS.

Contoh SQL konseptual (ganti password dengan nilai acak dan simpan melalui secret manager/prosedur VPS; jangan tempel password ke tiket atau shell history):

```sql
CREATE DATABASE arena_staging CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'arena_migrator'@'127.0.0.1' IDENTIFIED BY '<password-migrator-acak>';
GRANT CREATE, ALTER, DROP, INDEX, REFERENCES ON arena_staging.* TO 'arena_migrator'@'127.0.0.1';
CREATE USER 'arena_app'@'127.0.0.1' IDENTIFIED BY '<password-runtime-acak>';
GRANT SELECT, INSERT, UPDATE, DELETE ON arena_staging.* TO 'arena_app'@'127.0.0.1';
```

Periksa dukungan privilege `REFERENCES` pada versi target dan uji saat migrasi. Jika privilege diperlukan berubah, berikan hanya pada database staging ini. URL password di `DATABASE_URL` harus di-URL-encode bila mengandung karakter khusus.

Jalankan migrasi awal hanya pada database staging yang baru/kosong. `demo:migrate` menjalankan seluruh file `001`–`006` berurutan dan **bukan** migrator yang aman diulang untuk database berisi data:

```sh
cd /opt/arena/releases/<release>
DATABASE_URL='mysql://arena_migrator:<password-url-encoded>@127.0.0.1:3306/arena_staging' npm run demo:migrate
```

Gunakan mekanisme secret yang disetujui jika environment shell tersimpan di log. Jangan jalankan `demo:seed`. Migrasi `005` menghapus tabel percakapan Arena lama jika ada; pada database staging baru tabel itu tidak ada. Catat hasil migrasi dan pastikan semua migrasi sukses sebelum menyalakan API.

## 5. Konfigurasi environment

Buat `/etc/arena/arena.env`, pemilik `root:arena`, mode `0640`. Jangan commit file ini. Contoh berikut sengaja menyisakan nilai Portal Data/OIDC yang harus dikonfirmasi:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
LOG_LEVEL=info
TRUST_PROXY=true

DATABASE_URL=mysql://arena_app:<password-url-encoded>@127.0.0.1:3306/arena_staging
DB_POOL_SIZE=8
DB_QUEUE_LIMIT=50

AUTH_TOKEN_SECRET=<acak-minimal-32-karakter>
PIN_ENCRYPTION_KEY=<acak-minimal-32-karakter-berbeda-dan-dipertahankan>
SETUP_TOKEN=<acak-satu-kali-dan-simpan-aman>
ATTEMPT_FINALIZER_ENABLED=true
ATTEMPT_FINALIZER_INTERVAL_MS=30000
ATTEMPT_FINALIZER_BATCH_SIZE=20
# Aktifkan sementara saat load test login staging; log hanya statistik agregat tanpa NISN/PIN.
ARENA_LOGIN_DIAGNOSTICS=false
# Verifikasi bcrypt berjalan di worker thread agar event loop API tetap responsif.
# Mulai dari 3 pada VPS 4 vCPU; ubah hanya berdasarkan hasil staging dan beban layanan lain.
PASSWORD_VERIFY_WORKERS=3
PASSWORD_VERIFY_QUEUE_LIMIT=1000
ARENA_UPLOAD_DIR=/var/lib/arena/question-images
ARENA_WEB_URL=https://staging.arena.man1palembang.sch.id

# Isi hanya setelah pemilik Portal Data mengonfirmasi URL dan client staging.
PORTAL_DATA_BASE_URL=<base-url-portal-data-yang-terverifikasi>
PORTAL_DATA_SYNC_CLIENT_ID=<client-id-staging>
PORTAL_DATA_SYNC_CLIENT_SECRET=<secret-staging>
OIDC_ISSUER=<issuer-oidc-yang-terverifikasi>
OIDC_CLIENT_ID=<oidc-client-id-staging>
OIDC_REDIRECT_URI=https://staging.arena.man1palembang.sch.id/auth/sso/callback
OIDC_POST_LOGOUT_URI=https://staging.arena.man1palembang.sch.id/guru
```

Mulai dengan pool/queue kecil karena VPS juga menjalankan layanan lain. Nilai contoh bukan kapasitas yang telah diukur. Sesuaikan setelah memeriksa `max_connections`, beban puncak semua aplikasi, dan menguji staging. Worker bcrypt memakai CPU yang sama dengan API; jangan menaikkan jumlah worker tanpa mengukur CPU, event loop, serta latency endpoint soal dan autosave. Antrean worker dibatasi; jika penuh, login baru ditolak sementara dengan 503 agar memori dan latency layanan lain tetap terkendali. Jangan isi `REDIS_URL` kecuali Redis staging memang tersedia, diizinkan, dan tidak berbagi namespace/cache berisiko dengan layanan lain. Tanpa Redis, rate limit proses API bersifat lokal pada satu proses.

Contoh pengamanan file:

```sh
sudo chown root:arena /etc/arena/arena.env
sudo chmod 0640 /etc/arena/arena.env
```

`PORTAL_DATA_BASE_URL` dipakai untuk endpoint token `/oidc/token` dan API `/api/v1/integration/cbt/*`. `OIDC_ISSUER` adalah issuer OIDC yang diverifikasi, dan tidak boleh ditebak dari nama domain. Minta pemilik Portal Data menyiapkan client credential service dengan scope `portal_data.read` serta OIDC client staf terpisah. Daftarkan callback dan post-logout URL staging secara persis; jangan gunakan client secret produksi bila Portal Data menyediakan credential staging.

### Buat administrator pertama

Setelah API hidup melalui HTTPS dan readiness sehat, buat admin pertama satu kali melalui `POST /api/setup/admin` dengan `SETUP_TOKEN`, username, nama, dan password kuat minimal 12 karakter. Kirim permintaan dari komputer admin dan jangan menyimpan token dalam shell history. Endpoint menolak jika admin sudah ada. Segera hapus `SETUP_TOKEN` dari `/etc/arena/arena.env`, restart service, dan verifikasi endpoint setup tidak lagi aktif. Jangan gunakan akun demo.

## 6. systemd

Buat `/etc/systemd/system/arena-staging.service` setelah memastikan path Node pada VPS (`command -v node`). Contoh jika Node berada di `/usr/bin/node`:

```ini
[Unit]
Description=Arena CBT staging API
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
User=arena
Group=arena
WorkingDirectory=/opt/arena/current
EnvironmentFile=/etc/arena/arena.env
ExecStart=/usr/bin/node apps/api/dist/server.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
StateDirectory=arena
StateDirectoryMode=0750

[Install]
WantedBy=multi-user.target
```

Pastikan user `arena` bisa membaca release dan menulis `/var/lib/arena`. Validasi unit sebelum start:

Jika database menggunakan MariaDB atau nama unit service berbeda, sesuaikan `After=` dan `Wants=` berdasarkan hasil pemeriksaan VPS. Pastikan Nginx dapat menelusuri `/opt/arena/current/apps/web/dist` dan membaca aset build.

```sh
sudo systemd-analyze verify /etc/systemd/system/arena-staging.service
sudo systemctl daemon-reload
sudo systemctl enable --now arena-staging
sudo systemctl status arena-staging --no-pager
sudo journalctl -u arena-staging -n 100 --no-pager
```

API harus bind hanya ke `127.0.0.1:3001`. Jika database/OIDC belum siap, perbaiki konfigurasi dan restart; jangan membuka port API ke internet untuk troubleshooting.

## 7. Nginx dan TLS

Tambahkan server block khusus staging setelah memeriksa konfigurasi Nginx yang sudah ada. Jangan mengganti file konfigurasi global atau vhost Portal Data/CBT. Sesuaikan `root` dengan symlink release aktual. Baris `listen [::]:80` hanya dipakai jika IPv6 tersedia di VPS; hapus jika tidak.

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name staging.arena.man1palembang.sch.id;

    client_max_body_size 4m;

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location ^~ /auth/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /health/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        root /opt/arena/current/apps/web/dist;
        try_files $uri $uri/ /index.html;
    }
}
```

Uji sintaks dan reload secara terkontrol sesuai prosedur VPS:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

Terbitkan sertifikat setelah DNS mengarah ke VPS dan port 80/443 tersedia. Jika Certbot dengan plugin Nginx sudah menjadi standar VPS, jalankan `sudo certbot --nginx -d staging.arena.man1palembang.sch.id` melalui jendela perubahan yang disetujui. Periksa perubahan yang dibuat Certbot: semua proxy location harus berada pada server HTTPS, sedangkan HTTP hanya mengalihkan ke HTTPS. Jika VPS memakai TLS manager lain, ikuti prosedurnya. Aktifkan HSTS hanya setelah HTTPS staging stabil; jangan menambahkan `includeSubDomains` tanpa persetujuan pemilik domain.

`/api/question-images/:filename` harus tetap diproxy ke Fastify; jangan expose direktori upload langsung. File gambar soal berada di `/var/lib/arena/question-images`, terpisah dari release.

## 8. Aktivasi DNS, OIDC, dan pemeriksaan

Setelah HTTPS aktif, minta pemilik Portal Data memastikan callback OIDC staging tepat:

```text
https://staging.arena.man1palembang.sch.id/auth/sso/callback
```

Lalu verifikasi dari sisi VPS dan browser:

```sh
curl -fsS https://staging.arena.man1palembang.sch.id/health/live
curl -fsS https://staging.arena.man1palembang.sch.id/health/ready
sudo ss -lntp
sudo systemctl is-active arena-staging
```

Readiness harus menunjukkan database sehat. Jika Redis dikonfigurasi, readiness juga memerlukan Redis siap. Pastikan port 3001 hanya terikat localhost; database tidak menerima koneksi publik. Dari browser, uji halaman, aset, login admin, logout, cookie Secure, callback OIDC staf, reset password/PIN sesuai alur yang disetujui, tiket bantuan, unggah gambar, daftar ujian, autosave, dan submit memakai akun/ujian uji staging. Pastikan tidak ada data siswa produksi yang digunakan tanpa persetujuan.

Lakukan sync Portal Data pertama hanya setelah credential staging diverifikasi, pemilik akademik menyetujui, dan staging database dipastikan kosong/terisolasi. Tinjau jumlah, kegagalan, dan sample data sebelum menggunakan hasil sync.

## 9. Backup, pemantauan, dan rollback

- Backup database `arena_staging` dan `/var/lib/arena/question-images` dengan jadwal yang disetujui. Uji restore ke database staging terpisah.
- Pantau `journalctl -u arena-staging`, log Nginx, disk, RAM, CPU, pool database, deadlock, dan readiness. Jangan log token, PIN, password, atau isi jawaban.
- Simpan release sebelumnya dan arahkan symlink `current` ke release yang akan diaktifkan. Reload/restart service setelah build dan smoke test.
- Rollback kode hanya jika schema masih kompatibel dengan versi sebelumnya. Jangan membalik migration secara otomatis atau menghapus database untuk rollback. Restore backup hanya ke staging setelah disetujui dan pahami dampak kehilangan data sejak backup.
- Migrasi `005` menghapus tabel percakapan lama jika ada; `006` menambah metadata/sinyal integritas. Simpan salinan/backup staging sebelum migrasi bila database tidak kosong.
- Jangan menyebut staging siap produksi atau mendukung 1.200 siswa sebelum workflow ujian penuh, pemulihan, konkurensi, dan load test representatif berhasil pada server yang menyerupai target.

## Urutan checklist

1. [ ] Server, domain, DNS, MySQL, resource, dan vhost lama sudah diverifikasi.
2. [ ] Record DNS staging mengarah ke IP yang benar; TLS aktif.
3. [ ] Release yang ditinjau terpasang dan build berhasil.
4. [ ] Database `arena_staging` baru, user migrator/runtime terpisah, migrasi `001`–`006` sukses.
5. [ ] Environment file privat; cookie produksi Secure; service hanya localhost.
6. [ ] Nginx hanya menambah vhost staging; port database/API tidak terbuka ke publik.
7. [ ] Admin awal dibuat satu kali, lalu `SETUP_TOKEN` dihapus.
8. [ ] Portal Data staging/OIDC client dan callback dikonfirmasi pemiliknya.
9. [ ] Smoke test, sync awal terkontrol, backup, dan restore staging lulus.

**Status saat dokumen dibuat:** belum ada koneksi atau perubahan pada VPS, DNS, MySQL server, Nginx, TLS, Portal Data client, maupun deployment.




CREATE DATABASE arena_staging
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'arena_app'@'localhost'
  IDENTIFIED BY 'GANTI_PASSWORD_APP_RANDOM';

CREATE USER 'arena_migrator'@'localhost'
  IDENTIFIED BY 'GANTI_PASSWORD_MIGRATOR_RANDOM';

GRANT SELECT, INSERT, UPDATE, DELETE
  ON arena_staging.* TO 'arena_app'@'localhost';

GRANT SELECT, INSERT, UPDATE, DELETE,
  CREATE, ALTER, INDEX, DROP, REFERENCES
  ON arena_staging.* TO 'arena_migrator'@'localhost';

SHOW DATABASES LIKE 'arena_staging';

SHOW GRANTS FOR 'arena_app'@'localhost';

SHOW GRANTS FOR 'arena_migrator'@'localhost';



PortaldataMan2026Staging#

0116300717

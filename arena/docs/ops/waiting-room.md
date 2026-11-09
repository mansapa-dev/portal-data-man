# Ruang tunggu FIFO

Fitur ini menggantikan gate tingkat XII/XI/X dan timeout tiga menit. Antrean berlaku per `exam_id` (jadwal/sesi), berdasarkan pertama kali siswa menekan Mulai, bukan waktu login. Default maksimal 300 siswa dilepas setiap 10 detik; antrean kurang dari 300 tetap dilepas. Jumlah ADMITTED yang belum claim juga dibatasi sebesar batch size untuk menahan lonjakan request start. Sesudah claim, slot tersedia untuk pelepasan berikutnya. Menurunkan batch size tidak mencabut admission yang sudah diberikan.

## Perilaku dan konsistensi

`WAITING → ADMITTED → IN_EXAM → FINISHED`; heartbeat WAITING kedaluwarsa/logout menghasilkan ABANDONED, admission tanpa claim menghasilkan EXPIRED. ABANDONED/EXPIRED harus memilih **Masuk antrean lagi** dan mendapat nomor baru. Dua tab/perangkat berbagi satu entri dan satu attempt; logout mengakhiri antrean siswa tersebut pada semua perangkat. Logout tidak menghentikan attempt yang sudah berjalan.

Nomor antrean tetap, sedangkan posisi dan jumlah siswa di depan dapat berkurang. Sorted set menggunakan waktu Redis dan sequence sebagai tie-breaker. Seluruh admit, expiry, heartbeat, posisi, dan jadwal batch dijalankan dalam Lua atomic. Dua worker tidak bisa melepas batch yang sama. Tombol admin dapat mempercepat batch pertama; batch berikutnya tetap mengikuti interval agar klik ganda tidak membuka lonjakan baru.

ADMITTED menerima token acak privat dengan deadline claim. Token terikat pada siswa/ujian; semua API soal, jawaban, heartbeat ujian, pelanggaran, submit, review, dan hasil memvalidasi status/token. Login cookie, CSRF, dan pemeriksaan pemilik tetap berlaku. Token hanya di memori browser; setelah refresh server memulihkannya lewat sesi login. SSE menggunakan tiket bertanda tangan, bukan admit token di URL. Posisi/status dari client tidak dipercaya.

Attempt, snapshot soal, receipt claim, serta timer ditulis dalam satu transaksi MySQL ketika claim berhasil. Waktu tunggu tidak mengurangi durasi. `ends_at` menutup admission baru; siswa yang sudah claim memperoleh durasi penuh dari waktu claim meskipun melewati penutupan admission. Retry sesudah COMMIT mempertahankan attempt dan waktu kedaluwarsa yang sama. Worker merekonsiliasi receipt dengan Redis setiap 30 detik, termasuk pemulihan proses yang mati sesudah COMMIT.

## Instalasi dan migrasi

Gunakan Node >=22 serta MySQL dan Redis yang sudah digunakan aplikasi. Dari `arena/`:

```sh
npm install
npm run build
node --env-file=.env scripts/migrate-waiting-local.mjs
```

Helper migrasi di atas sengaja hanya menerima DB loopback. Untuk deployment, terapkan **hanya** `database/migrations/012_waiting_room.sql` melalui prosedur migrasi yang biasa digunakan, sebelum menjalankan API baru. Migrasi menambahkan `exam_waiting_settings` dan `exam_waiting_claims`; tidak menghapus attempt/jawaban/hasil. Jangan menjalankan ulang seluruh migrasi awal pada DB yang berisi data. Rollback manual ada di `database/rollbacks/012_waiting_room.sql`, tidak dijalankan otomatis, dan memerlukan backup serta penonaktifan kode baru terlebih dahulu.

API dan web harus diperbarui bersamaan. Endpoint gate lama `/admission` memberi 410 agar client lama memuat ulang. Attempt yang sudah berjalan sebelum migrasi dapat dilanjutkan melalui resume, tanpa masuk antrean baru.

## Konfigurasi dan worker

| Env | Default | Fungsi |
| --- | --- | --- |
| `WAITING_BATCH_SIZE` | `300` | Maksimal siswa per batch dan outstanding admission |
| `WAITING_BATCH_INTERVAL_MS` | `10000` | Jarak minimum pelepasan |
| `WAITING_HEARTBEAT_TIMEOUT_MS` | `90000` | WAITING tanpa heartbeat menjadi ABANDONED |
| `WAITING_CLAIM_TIMEOUT_MS` | `120000` | ADMITTED tanpa claim menjadi EXPIRED |
| `WAITING_WORKER_TICK_MS` | `1000` | Interval pemeriksaan worker |
| `WAITING_WORKER_ENABLED` | `true` | Worker tertanam pada API |
| `REDIS_URL` | konfigurasi yang sudah ada | Redis bersama seluruh API/worker |
| `AUTH_TOKEN_SECRET` | konfigurasi yang sudah ada | Secret yang sama pada seluruh API/worker |

Default dipakai bila admin belum menyimpan pengaturan ujian tersebut. Panel **Pengaturan Sistem → Ruang tunggu FIFO** menyediakan jumlah menunggu/admitted/mengerjakan/selesai, pelepasan batch, pause/open, ukuran batch, interval, serta timeout. Pengaturan yang tersimpan mengalahkan env. Perubahan interval dihitung dari pelepasan terakhir; perubahan heartbeat/claim timeout berlaku pada heartbeat/admission berikutnya.

Worker tertanam cukup untuk instalasi biasa; aman berjalan pada beberapa instance API. Untuk proses worker khusus, atur `WAITING_WORKER_ENABLED=false` pada API dan jalankan dari `arena/`:

```sh
node --env-file=.env apps/api/dist/waiting-worker.js
```

Gunakan pengelola proses dengan restart otomatis. Worker standalone tidak membuka port HTTP. Semua proses harus memakai DB, Redis, dan secret yang sama. Jika semua worker berhenti, antrean tersimpan tetapi tidak dilepas; status tidak memberi izin masuk sendiri.

Aktifkan Redis AOF dan `maxmemory-policy noeviction`; sediakan memori cukup dan monitor kegagalan write/latensi. Posisi WAITING/ADMITTED ada di Redis dan tidak direplikasi ke MySQL. Restart proses dengan data Redis utuh aman; kehilangan seluruh data Redis menghilangkan antrean yang belum claim. Receipt MySQL hanya memulihkan attempt yang sudah claim. AOF `everysec` masih dapat kehilangan write terakhir ketika host mati; gunakan kebijakan persistensi sesuai kebutuhan operasional. Key ujian disimpan hingga 48 jam setelah waktu akhir/aktivitas.

SSE memakai satu subscriber Redis per proses, flush perubahan maksimal tiap lima detik dan keepalive 25 detik. Proxy harus menonaktifkan buffering/cache SSE dan memakai read timeout >25 detik; contoh ada di `infra/nginx-server.conf`. Tidak memerlukan sticky session. Client reconnect otomatis, fallback polling 4,5–5,5 detik dengan jitter, heartbeat sekitar 20 detik, serta safety polling 30 detik ketika SSE aktif. Heartbeat dipercepat bila admin mengurangi timeout.

## API

Semua ID siswa berasal dari sesi login, tidak dari body/query.

| Endpoint | Fungsi |
| --- | --- |
| `POST /api/student/exams/:id/waiting/join` | Join idempotent; body `{}` atau `{ "rejoin": true }` |
| `GET .../waiting/status` | Status sendiri, baca Redis |
| `POST .../waiting/heartbeat` | Perpanjang kehadiran WAITING |
| `POST .../waiting/leave` | Keluar eksplisit |
| `GET .../waiting/events?ticket=...` | SSE cookie sesi dan tiket terikat siswa |
| `POST .../waiting/claim` | Header `X-Exam-Token`, membuat/memulihkan attempt |
| `POST .../waiting/resume` | Memulihkan credential attempt yang sudah ada |
| `GET /api/admin/waiting-room/:id` | Ringkasan admin |
| `PUT .../settings` | Simpan konfigurasi dan audit |
| `POST .../release` | Body `{ "expected_batch": 0 }`, pelepasan atomic dan audit |

Mutasi memerlukan CSRF. Join/status/heartbeat/SSE diberi rate limit per siswa, dibagi melalui Redis antar-instance. Admission baru gagal tertutup ketika Redis tidak tersedia. Request ujian dengan token yang sudah di-claim dapat divalidasi terhadap receipt MySQL ketika state Redis tidak tersedia; tidak ada bypass untuk siswa WAITING.

## Pengujian lokal

Gunakan DB dummy terpisah bernama `arena_waiting_test_*`. Setup berikut membuat schema baru bila belum ada, tanpa menghapus DB/data lama. Jangan arahkan ke DB operasional.

```sh
# Contoh shell POSIX; gunakan $env:NAMA='nilai' pada PowerShell.
export WAITING_TEST_DATABASE_URL='mysql://root:password@127.0.0.1:3308/arena_waiting_test_fifo'
export REDIS_TEST_URL='redis://127.0.0.1:6379'
node scripts/setup-waiting-tests-local.mjs
npm run build -w @arena/api
node --test apps/api/tests/waiting-room.unit.test.mjs apps/api/tests/waiting-room.integration.test.mjs apps/api/tests/waiting-room.http.test.mjs
node --test apps/web/tests/api-timeout.test.mjs
```

Unit test memeriksa credential/signature/expiry dan validasi input. Test Redis/MySQL menjalankan state machine nyata, idempotency, FIFO 1.000 join bersamaan + duplicate join, dua worker, perubahan batch, heartbeat/claim expiry, pause/jadwal, crash sesudah COMMIT, timer penuh, dan 5.000 siswa dengan status/heartbeat tanpa DB. Test HTTP memeriksa auth, CSRF, rate limit, kepemilikan, seluruh guard ujian, answer/submit, admin dan SSE.

Hasil lokal 9 November 2026: seluruh 119 test API (termasuk 14 test unit/integrasi/HTTP waiting room) dan 3 test helper frontend lulus; build API serta web lulus. Pada suite gabungan, 5.000 join sekitar 1,63 detik, 5.000 status + 1.000 heartbeat sekitar 0,77 detik pada fixture lokal. Angka ini bukan SLA atau bukti 5.000 koneksi HTTP/SSE serentak. Jalankan k6 pada infrastruktur yang representatif sebelum menetapkan kapasitas produksi.

## Load test

Seed berikut hanya menerima DB lokal non-production dan membuat siswa/paket dummy baru pada setiap run. Token dummy disimpan di `tmp/` yang diabaikan Git. Jalankan API dengan `.env` lokal yang sama dan worker aktif:

```sh
node --env-file=.env scripts/seed-waiting-load-local.mjs
node --env-file=.env apps/api/dist/server.js
# Terminal lain, k6 terpasang:
k6 run -e BASE_URL=http://127.0.0.1:3001 -e VUS=5000 tests/k6/waiting-room.js
```

`WAITING_LOAD_STUDENTS` mengatur jumlah seed (default 5000, minimal 1000); `-e MODE=simultaneous` meniadakan jitter join; `-e FINISH=false` mempertahankan attempt tanpa submit. Skrip memeriksa nomor tetap, admission, claim, durasi penuh, dan submit. Gunakan fixture baru untuk run berikutnya. Skrip k6 ini mengukur fallback HTTP, bukan 5.000 stream SSE; uji koneksi SSE terpisah diperlukan. Pantau CPU, memori, event loop, koneksi terbuka, Redis latency, pool/lock MySQL, dan p95/p99 claim/status. k6 belum dijalankan pada mesin kerja ini.

Keterbatasan: implementasi memakai satu Redis primary/logical instance (jangan memakai Redis Cluster tanpa menyesuaikan akses dynamic key dalam Lua). Pengaturan dan receipt tahan restart di MySQL; antrean bergantung pada persistensi Redis. Queue yang sudah berakhir tetap terdaftar untuk recovery berkala; instalasi dengan banyak jadwal historis dapat menambah pembersihan registry setelah masa retensi. Tidak ada framework baru yang ditambahkan.

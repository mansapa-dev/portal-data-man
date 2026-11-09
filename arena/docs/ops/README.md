# Rencana konfigurasi Arena untuk staging

Kontrol pembukaan tingkat XII → XI → X dijelaskan di [grade-admission.md](grade-admission.md).

Semua berkas di `infra/` adalah contoh untuk diterapkan manual setelah uji staging. Tidak ada perubahan sistem yang dilakukan oleh pekerjaan lokal ini. Simpan salinan konfigurasi lama sebelum memasang setiap berkas, jalankan pemeriksaan sintaks, lalu terapkan satu komponen per waktu.

1. Bangun aplikasi dengan Node >=22. Atur `ARENA_DIR`, `DATABASE_URL`, `REDIS_URL`, dan secret hanya di environment manager server. `infra/ecosystem.config.cjs` menjalankan tiga proses API pada port yang sama melalui PM2 cluster. `PASSWORD_VERIFY_WORKERS=1` per proses memberi total tiga worker bcrypt pada mesin empat vCPU. Jangan menaruh secret di ecosystem file.
2. Letakkan directive `infra/nginx-main.conf` pada konteks `main`/`events`, `infra/nginx-http.conf` di `http`, dan `infra/nginx-server.conf` dalam server block Arena. Sesuaikan nama upstream dan lokasi log dengan konfigurasi yang ada. Jalankan `nginx -t`, lalu reload. Snippet mematikan access log hanya untuk jalur ujian siswa; log lain tetap buffered.
3. Tinjau `infra/99-arena.conf`, salin ke `/etc/sysctl.d/99-arena.conf`, jalankan `sysctl --system`, lalu verifikasi nilai. Untuk service yang menjalankan PM2/API, pasang `infra/arena.service.d/limits.conf` sebagai systemd drop-in, `systemctl daemon-reload`, restart service pada jendela pemeliharaan, dan periksa `ulimit -n` proses.
4. Gabungkan `infra/redis.conf.snippet` ke konfigurasi Redis yang dipakai setelah memeriksa kapasitas dan kebijakan persistensi setempat. Restart Redis secara terencana; pastikan AOF aktif dan kebijakan `noeviction` terbaca. Redis harus berada di jaringan privat dengan akses hanya dari proses API; cache soal Redis berisi kunci jawaban untuk kebutuhan server. Jawaban siswa dan hasil tetap ditulis ke MySQL.

Rollback: kembalikan salinan konfigurasi lama per komponen, jalankan pemeriksaan sintaks (`nginx -t`), reload nginx; pulihkan file sysctl lalu `sysctl --system`; pulihkan service drop-in dan `daemon-reload`/restart; pulihkan konfigurasi Redis dan restart terencana; jalankan PM2 memakai ecosystem lama. Jangan menghapus volume atau data DB/Redis untuk rollback.

Tuning awal sengaja konservatif: pool DB 12 koneksi per proses (maksimum 36 pada tiga proses), log `warn`, cache sumber soal lokal/Redis 2 detik. Ukur p95, antrean pool, lock MySQL, CPU per core, event loop, Redis latency, dan error sebelum menaikkan nilainya. `DB_CONNECT_TIMEOUT_MS` membatasi pembukaan koneksi TCP, bukan waktu antre pool.

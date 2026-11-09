# Rencana implementasi ruang tunggu FIFO

## Temuan sebelum coding

Backend memakai Fastify, TypeScript, mysql2 dan ioredis; frontend memakai React/TypeScript. Login menggunakan cookie sesi dan CSRF. Rute siswa ada di `routes/student-exams.ts`; `StudentExamService.start` membuat attempt serta snapshot soal dalam transaksi MySQL. Penilaian berada di `ScoringService`. Redis sudah dipakai untuk cache soal. Ruang tunggu lama hanya membuka tingkat XII/XI/X berdasarkan kuota/waktu dan belum mempunyai antrean per siswa, claim token, expiry, atau scheduler FIFO.

## Asumsi

- Spesifikasi FIFO terbaru menggantikan prioritas tingkat dan batas tiga menit. Satu ID ujian sudah menunjuk jadwal/sesi; antrean berbeda ID ujian tidak saling mencampur peserta.
- Default: batch maksimal 300 setiap 10 detik, heartbeat timeout 90 detik, claim timeout 120 detik. Batch kecil tetap dilepas. Angka dapat diubah admin, berlaku pada pelepasan berikutnya.
- Jadwal `ends_at` menutup pendaftaran/claim baru. Peserta yang sudah claim memperoleh durasi penuh dari waktu claim, termasuk bila durasinya melewati penutupan pendaftaran. Menunggu tidak membuat attempt atau mengurangi durasi.
- Dua tab/perangkat milik siswa memakai satu entri server. Logout meninggalkan seluruh antrean WAITING siswa; putus koneksi tanpa logout memakai timeout. ABANDONED/EXPIRED dapat rejoin secara eksplisit di urutan belakang.
- Redis menjadi sumber posisi/transisi antrean dengan AOF/noeviction. MySQL menyimpan pengaturan dan bukti claim yang bertransaksi bersama attempt; ini dipakai untuk rekonsiliasi sesudah restart atau respons claim hilang.
- Worker dapat berjalan bersama API atau sebagai proses terpisah. Semua worker memakai jadwal pelepasan atomic yang sama, sehingga restart/worker ganda tidak menggandakan batch.

## Urutan dan berkas

1. Migrasi additif/reversible `012_waiting_room.sql` dan rollback: pengaturan per ujian dan claim durable per siswa/ujian.
2. `services/waiting-room-lua.ts`, `waiting-room.ts`: sorted set FIFO, sequence tie-breaker, heartbeat/claim expiry, state machine, token dan rekonsiliasi MySQL.
3. `routes/waiting-room.ts` dan `student-exams.ts`: join/status/heartbeat/leave/claim/resume; guard seluruh API ujian; sambungkan logout, start, dan submit.
4. `services/waiting-room-worker.ts`, CLI worker, bootstrap/shutdown: pelepasan batch atomic, cleanup, recovery.
5. `services/waiting-room-events.ts`: satu subscription Redis per proses, SSE dibatasi per lima detik, backpressure, dan pengecekan sesi.
6. `ExamWaitingRoom.tsx`, `main.tsx`, `lib/api.ts`: posisi, koneksi, retry/rejoin, SSE/fallback polling, token hanya di memori dan pemulihan refresh.
7. `ExamAdmissionControl.tsx`: dashboard FIFO dan form konfigurasi, menggantikan kontrol tingkat.
8. Tes state/transaksi, integrasi Redis, konkurensi minimal 1.000 join, serta skrip k6 5.000 siswa. Dokumentasi env, migrasi, worker, SSE/proxy dan keterbatasan validasi.

Semua pekerjaan dan layanan pengujian tetap lokal. Berkas lokal lain yang sudah ada dipertahankan.

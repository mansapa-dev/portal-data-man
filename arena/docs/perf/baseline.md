# Fase 0 — audit alur ujian Arena

Tanggal audit: 2026-11-09. Lingkup: kode lokal `arena/`; tidak ada koneksi ke staging atau production. Temuan di bawah adalah hasil pembacaan kode, bukan pengukuran latency.

## Baseline k6

**Belum dapat dijalankan.** `k6` dan `docker` tidak ditemukan di PATH maupun lokasi instalasi Windows yang umum; `arena/.env` dan `arena/apps/api/.env` tidak ada. Node yang tersedia di Laragon adalah v18, sedangkan `arena/package.json` mensyaratkan Node >=22. Repo belum berisi `docker-compose.dev.yml`, seed 1.015 siswa/40 soal, token dummy massal, atau skrip k6 alur ujian. Karena tidak ada target HTTP dan data uji lokal yang siap, tidak ada angka p50/p95/error rate yang sah untuk baseline. Skrip `apps/api/tests/local-load-test.mjs` yang sudah ada adalah uji service langsung, bukan k6 HTTP 1.015 VU. Setelah audit ini, perubahan terbatas pada pembacaan sumber soal dibuat atas permintaan lanjutan pengguna; perbandingan sebelum/sesudah kelak harus menjalankan versi kode sebelum perubahan sebagai baseline terpisah.

## Peta request

| Alur / endpoint | Operasi DB per request normal | Write | Kunci ke respons? |
| --- | --- | --- | --- |
| Daftar ujian `GET /api/student/exams` | 1 SELECT dengan JOIN dan beberapa EXISTS; dipakai untuk menampilkan daftar/akses | 0 | Tidak |
| Load soal + mulai `POST /api/student/exams/:id/start` (baru) | 3 SELECT: siswa/attempt, metadata ujian, seluruh soal aktif; 1 INSERT attempt; 1 bulk INSERT 40 snapshot `attempt_questions`; 1 transaksi | 41 baris untuk 40 soal; 2 statement | Tidak: formatter hanya mengirim ID, teks, opsi, poin, waktu, jawaban siswa |
| Mulai ulang / resume endpoint yang sama | 6 SELECT: siswa/attempt, attempt terkunci, ujian, status aktif, snapshot soal, jawaban/revisi; 1 transaksi | 0 | Tidak |
| Simpan jawaban `PUT /api/student/exams/:id/answers/:questionId` | 1 SELECT JOIN terkunci, 1 INSERT/UPDATE `student_answers` bila perlu, 1 INSERT/UPDATE `answer_write_versions`; 1 transaksi per jawaban | Umumnya 2 statement / jawaban | Tidak |
| Selesai `POST /api/student/exams/:id/submit` | 2 SELECT awal; 1 SELECT 40 snapshot+answer; 1–2 SELECT metadata jika cache 60 detik belum hangat; 1 INSERT hasil; 1 UPDATE attempt; 1 transaksi | 2 statement | Tidak; skor dihitung sinkron dalam request |
| Heartbeat `POST /api/student/exams/:id/heartbeat` | 1 INSERT … SELECT … ON DUPLICATE KEY UPDATE | Hingga 1 row/heartbeat | Tidak |
| Hasil `GET /api/student/exams/:id/result` | 1 SELECT JOIN | 0 | Tidak |
| Review `GET /api/student/exams/:id/review` | 2 SELECT; server membaca kunci untuk menghitung status per soal | 0 | Tidak mengirim kunci mentah; mengirim status BENAR/SALAH/SEBAGIAN setelah ujian |

Catatan: jumlah operasi di atas tidak mencakup operasi Redis dari middleware rate limit, retry deadlock, finalizer kedaluwarsa, atau request frontend `loadExams()` sesudah submit. `start` sekaligus menjadi endpoint load soal; tidak ada GET soal terpisah sekarang.

## Penyimpanan browser dan payload

Pencarian semua pemakaian `localStorage`/`sessionStorage` pada `arena/apps/web` menunjukkan hanya `localStorage` untuk `mansapa-cbt-theme-v2` (tema) dan `arena_active_portal` (`student`/`staff`). Tidak ada pemakaian `sessionStorage`. Paket soal, jawaban siswa, revisi, flag, attempt, token dan CSRF berada di state/memori JavaScript; token juga dapat dipulihkan lewat cookie sesi server. Kode `start` mengambil `correct_answer` dari DB dan memasukkannya ke `attempt_questions`, tetapi pemformat respons memilih field aman secara eksplisit. Ini perlu dikunci dengan test regresi respons HTTP pada Fase 1. Klaim bahwa kunci berada di localStorage tampaknya berlaku pada implementasi lain/versi lama, bukan frontend Arena yang diperiksa.

## Titik beban dan konfigurasi

- Pada 1.015 mulai serentak dengan 40 soal: sekitar 40.600 baris snapshot `attempt_questions` ditulis, plus 1.015 attempt. Soal sumber yang sama dibaca ulang untuk setiap siswa. Mapping/urutan diacak per siswa di event loop.
- Autosave berjalan 350 ms setelah perubahan dan mengirim satu request serta satu transaksi per soal. Untuk 40 jawaban × 1.015 siswa, ini sampai 40.600 transaksi dan sekitar 81.200 write statement, sebelum revisi/flag/retry. Lock `FOR SHARE OF ea` mencegah submit mendahului autosave yang sedang berjalan; konflik per revisi dapat memicu retry/409.
- Submit membaca 40 baris untuk menghitung skor dan menahan transaksi hingga INSERT hasil dan UPDATE attempt selesai. `submitInFlight` hanya melindungi satu proses; unik `(student_id, exam_id)` pada attempt dan unik `attempt_id` pada hasil membantu idempotensi DB.
- Pool MySQL default 50 koneksi, `.env.example` menyarankan 60 dan antrean 10.000; tidak terlihat `acquireTimeout` eksplisit. `REQUEST_TIMEOUT_MS` default 45 detik adalah timeout request HTTP, bukan timeout menunggu pool. Banyak request serentak dapat mengantre lama.
- Fastify logger default `info`, yang mencatat request/response; error handler juga mencatat error. Rate limit global memakai Redis bila dikonfigurasi, lalu pemeriksaan token/CSRF dan validasi Zod pada rute ujian. Tidak ada bcrypt pada mulai/soal/jawab/submit. Pengukuran perlu membedakan waktu antre pool, query/lock DB, CPU event loop, Redis rate limit, dan overhead log; disk tidak dapat dinyatakan sebagai bottleneck dari audit kode ini.
- `StudentExamService` sudah memiliki diagnostik agregat autosave dan heartbeat (`ARENA_EXAM_DIAGNOSTICS=true`), tetapi belum ada pengukuran baseline di mesin ini. Finalizer kedaluwarsa juga memakai DB dan memanggil scoring berkala, sehingga perlu dipantau saat uji.

## Rencana setelah persetujuan

1. Siapkan lingkungan lokal dan data dummy sesuai skema; jalankan k6 HTTP baseline 1.015 VU sebelum mengubah alur. Simpan hasil mentah dan ringkasan, termasuk metrik pool/lock, event loop, Redis, dan error.
2. Tambahkan test kontrak respons soal bebas kunci. Pertahankan sifat frontend saat ini yang tidak menyimpan soal di storage; audit field bocor pada rute lain.
3. Rancang perubahan Redis dengan menjaga semantik yang sudah ada: eligibility kelas/siswa, soal multiple response dan short answer, poin parsial, flag/revisi dan mutation id, heartbeat, pelanggaran/terminasi, resume, finalizer, hasil/review. Jangan memindahkan skor ke client. Buat migrasi reversible bila penyimpanan hasil JSON baru diperlukan.
4. Implementasikan dan uji bertahap, lalu ukur k6 sesudah perubahan dengan skenario yang identik. Konfigurasi infra hanya ditulis di repo untuk penerapan manual nanti.

Asumsi awal: `arena/apps/web` adalah client yang dimaksud dan alur lama `cbt/` tidak termasuk lingkup. Belum ada bukti numerik untuk menyebut satu bottleneck sebagai penyebab dominan; angka operasi di atas adalah potensi beban menurut kode.

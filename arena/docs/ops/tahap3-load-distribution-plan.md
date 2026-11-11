# Tahap 3 — Pemerataan beban menjawab, submit, dan ruang tunggu

Status: **D1–D8 diimplementasikan, tanpa load test.** Dokumen ini melanjutkan
Fase 1 (cache soal) dan Tahap 2 (submit asinkron). Angka di bawah adalah
**estimasi analitis** dari kode dan konfigurasi, bukan hasil pengukuran.

## 0. Status implementasi

| # | Perubahan | Commit |
|---|---|---|
| D1 | Jitter claim 0..min(interval batch, 8 dtk) | `e95bf66b` |
| D2 | Backoff + jitter poll `/result` | `edb990d2` |
| D3 | Jitter auto-submit 0..2 dtk | `e5bf5563` |
| D6 | `waiting.finish` setelah response submit | `bbc16a60` |
| D4 | Phase + jendela flush autosave 2,5–5,5 dtk | `be157813` |
| D5 | SSE dirty per siswa | `f51b4f30` |
| D7 | Default claim timeout 60 dtk | `f98fd49e` |
| D8 | Diagnostik bentuk beban (`ARENA_LOAD_DIAGNOSTICS`) | commit ini |

Verifikasi: 206 test API (197 lulus, 0 gagal, 9 skip karena butuh DB/Redis
terpisah), 4 test helper web + 3 test timeout web lulus, build API dan web
lulus. Load test tidak dijalankan pada tahap ini.

## 1. Ringkasan eksekutif

Masalah utama bukan kapasitas satu request, melainkan **sinkronisasi**:
banyak siswa melakukan hal yang sama pada detik yang sama.

Sumber sinkronisasi terbesar adalah **pelepasan ruang tunggu**: 300 siswa
di-admit sekaligus setiap 10 detik. Rantai efeknya:

```
release 300 sekaligus
  → 300 claim hampir bersamaan
  → 300 start + snapshot soal bersamaan
  → 300 jawaban pertama hampir bersamaan
  → 300 expires_at pada detik yang sama
  → 300 auto-submit hampir bersamaan
  → 300 poll /result pada detik yang sama
```

Ditambah dua herd lain yang tidak terikat batch admission:

1. **Mass expiry di `ends_at`** — semua attempt yang belum selesai dipangkas ke
   `ends_at` yang sama, sehingga auto-submit bisa menjadi 1.200 request pada
   satu detik.
2. **Polling hasil** — semua siswa yang submit memanggil `/result` tiap 2 detik
   tanpa jitter/backoff, sehingga 1.200 siswa menghasilkan ~600 request/detik
   selama scoring berjalan.

Rekomendasi inti: **sebar di klien (jitter/backoff) + rapikan titik sinkron di
server**, tanpa mengubah semantik ujian, tanpa migrasi DB, dan tanpa
menambah infrastruktur baru. Urutan prioritas ada di §6.

## 2. Metode audit

- Baca kode jalur siswa: `main.tsx`, `StudentExam.tsx`, `ExamWaitingRoom.tsx`,
  `lib/api.ts`.
- Baca jalur API: `routes/student-exams.ts`, `routes/waiting-room.ts`,
  `services/student-exam.ts`, `services/waiting-room*.ts`,
  `services/expired-attempt-finalizer.ts`.
- Baca konfigurasi: `lib/db.ts`, `lib/redis.ts`,
  `infra/ecosystem.config.cjs`, `.env.example`.
- Tidak menjalankan beban, tidak menyentuh DB/Redis production.

## 3. Peta beban saat ini

Asumsi: 1.200 siswa, 40 soal, 60 menit, 3 proses API (pool 12/proses = 36
koneksi), `WAITING_BATCH_SIZE=300`, `WAITING_BATCH_INTERVAL_MS=10000`.

| Jalur | Pemicu | Laju steady | Bentuk burst | Biaya utama |
|---|---|---|---|---|
| Login siswa | 1.200 siswa masuk | 1.200 total | semua di awal sesi | bcrypt 1 worker/proses (`auth.ts:105-145`) |
| `waiting/join` | setelah login | 1.200 total | 1.200 dalam hitungan detik | 1 query + Lua `configure` + `SADD` (`waiting-room.ts:65-81`) |
| `waiting/status` | poll 4,5–5,5 dtk | ~240/dtk | — | 1 Lua ~10–15 perintah (`ExamWaitingRoom.tsx:39`) |
| SSE flush | tiap 5 dtk saat ada perubahan | ~240/dtk | saat join/release | 1 Lua **per klien** (`waiting-room-events.ts:44-59`) |
| `waiting/heartbeat` | ~30 dtk | ~40/dtk | — | 1 Lua (`ExamWaitingRoom.tsx:17`) |
| `waiting/claim` | ADMITTED | 30/dtk rata-rata | **300 sekaligus tiap 10 dtk** | 1 transaksi: attempt + ±40 baris snapshot + receipt (`student-exam.ts:203-279`) |
| Autosave batch | perubahan jawaban | ~10–20/dtk | 300 per jendela 1 dtk tiap 10 dtk | 1 transaksi + guard Redis (`main.tsx:107-125`) |
| Submit | tombol / waktu habis | 1.200 total | 300 tiap 10 dtk; **worst 1.200 di `ends_at`** | TX1 + `waiting.finish` + enqueue (`student-exams.ts:103-139`) |
| `/result` poll | setelah submit | **~600/dtk** selama drain | sinkron tiap 2 dtk | guard Redis + query 3 join (`main.tsx:42-63`) |
| Heartbeat ujian | 45–60 dtk | ~24/dtk | — | upsert `attempt_connections` (`student-exam.ts:308-328`) |
| Scanner expiry | tiap 10 dtk | 1.200 saat mass expiry | 1.200 job sekaligus | worker concurrency 4 (`expired-attempt-finalizer.ts:146-179`) |

Catatan: rate limit `waiting/status` 24/menit dan poll 4,5–5,5 dtk masih di
bawah batas; rate limit login per NISN (bukan per IP), jadi 1.200 siswa di
satu jaringan sekolah tidak saling memblokir (`auth.ts:49-52`).

## 4. Temuan

### F1 — Pelepasan admission adalah sumber sinkronisasi utama

`waiting-room-lua.ts:134-161` melepas sampai `batch_size` siswa dalam satu Lua
atomik. Semua siswa yang dilepas mendapat `claim_deadline_ms` yang sama dan
langsung menerima status ADMITTED lewat SSE/poll. Di klien,
`ExamWaitingRoom.tsx:31-34` **langsung** memanggil claim tanpa jeda. Efeknya
300 claim, 300 start, 300 autosave pertama, dan 300 expiry terjadi pada
jendela waktu yang hampir identik.

Ini bukan bug: batch adalah pengaman agar claim tidak membuka lonjakan.
Masalahnya, batch 300/10 dtk menghaluskan **antar batch**, tetapi tidak
menghaluskan **di dalam batch**.

### F2 — Auto-submit di `ends_at` bisa menjadi 1.200 serentak

`StudentExam.tsx:64` memanggil `submit(true)` tepat saat `remaining === 0`.
`expires_at` dihitung `min(start + durasi, ends_at)` (`student-exam.ts:240-243`).
Siswa yang claim terlambat semua mendapat `ends_at` yang sama, sehingga
auto-submit mereka menumpuk di satu detik. Tidak ada jitter di klien maupun
di server.

### F3 — Polling hasil tanpa jitter/backoff

`waitForResult` (`main.tsx:42-63`) memanggil `/result` tiap 2.000 ms tetap,
maksimal 20 kali (40 dtk). Setelah submit massal, semua klien mem-poll pada
batas 2 dtk yang sama. Setiap poll = guard Redis + query `exam_attempts` +
`exam_results` + `exam_follow_up_meta` + `exam_submissions`
(`student-exams.ts:141-150`). Ini beban **sustained** ~600 query/dtk, bukan
sekadar burst. Jika drain worker lebih dari 40 dtk, klien berhenti polling dan
menampilkan error padahal submission sudah durable.

### F4 — Jitter autosave hanya selebar 1 detik

`main.tsx:123`: flush batch dijadwalkan `3000 + rand(0..1000)` ms. Untuk
kohort 300 siswa yang mulai pada detik yang sama, 300 flush tetap terjadi
dalam jendela ~1 detik. Debounce 350 ms per perubahan (`main.tsx:229`) sudah
baik; yang kurang adalah penyebaran **fase** antar siswa.

### F5 — SSE membaca ulang semua klien saat ada perubahan

`waiting-room-events.ts:20` menandai **seluruh exam** dirty saat satu siswa
berubah. `flush()` (`:44-59`) lalu memanggil `service.status()` untuk setiap
klien exam itu. Selama admission (join/release terus-menerus), 1.200 klien
dibaca ulang tiap 5 detik = ~240 Lua/dtk tambahan, padahal biasanya hanya
sebagian kecil siswa yang berubah. Beban ini masih sanggup ditangani Redis,
tetapi merupakan pemborosan yang tumbuh linear dengan jumlah siswa.

### F6 — `waiting.finish` berada di jalur kritis submit

`student-exams.ts:116` menunggu `waiting.finish` (UPDATE MySQL
`exam_waiting_claims` + Lua Redis) **sebelum** mengembalikan `accepted`.
Padahal penerimaan durable sudah commit di TX1; status ruang tunggu bukan
syarat penerimaan. Saat 1.200 submit bersamaan, ini menambah satu write DB +
satu Lua ke setiap response dan memperpanjang tail latency.

### F7 — Kapasitas admission bisa tertahan `claim_timeout`

`capacity = batch_size - ZCARD(admitted)` (`waiting-room-lua.ts:139`).
`claim_timeout_ms` default 120 dtk (`waiting-room.ts:39`). Jika 300 siswa
ADMITTED tetapi perangkatnya tidur/tidak claim, slot tidak dilepas sampai
120 dtk, sehingga 900 siswa di belakang menunggu tanpa progres. Dengan jitter
claim yang wajar (≤10 dtk) ini jarang terjadi, tetapi tetap perlu batas yang
lebih ramah.

### F8 — Mass expiry dan scanner

Scanner mengambil maksimal 1.500 attempt per batch dengan concurrency 4
(`expired-attempt-finalizer.ts:146-179`). Di production, scanner berjalan di
`arena-finalization` dan meng-enqueue job ke BullMQ (concurrency 4), jadi
1.200 expiry menjadi 1.200 job dan drain ~20–25 detik. Ini **bounded** dan
tidak kehilangan data, tetapi antrean Redis melonjak dan `/result` harus
memakai backoff (F3) agar tidak menambah beban saat drain.

### F9 — Login adalah gerbang masuk yang belum dihaluskan

1.200 login dengan bcrypt 3 worker (1/proses) ≈ 40 dtk CPU total jika semua
datang bersamaan. Klien sudah retry 1–4 dtk saat 503 (`main.tsx:150-159`),
tetapi belum ada jitter proaktif sebelum login. Ini bukan fokus utama, namun
mempengaruhi kapan siswa masuk antrean.

### F10 — Redis adalah dependensi bersama; kegagalan harus tetap tertutup rapi

Guard autosave/submit/`/result` memakai Redis, tetapi `waiting.authorize`
punya fallback ke receipt MySQL (`waiting-room.ts:153-164`), sehingga siswa
IN_EXAM tetap bisa menjawab/submit saat Redis bermasalah. Admission baru
gagal tertutup (503) — perilaku yang benar. Yang perlu dipastikan: jalur
fallback ini tidak menambah query tak terduga saat Redis down.

### F11 — Observability beban belum memadai

Diagnostik autosave/heartbeat/login ada, tetapi tidak ada metrik per detik
untuk: claim latency, submit acceptance latency, `/result` poll rate, umur
antrean submission, jumlah ADMITTED yang tidak claim, dan release per batch.
Tanpa itu, efek pemerataan beban sulit diverifikasi di staging.

## 5. Desain usulan

Prinsip: **tidak mengubah semantik ujian** (durasi, jawaban, penilaian,
status), **tanpa migrasi DB**, dan semua perubahan bisa dimatikan lewat
konfigurasi/build flag.

### D1 — Jitter claim di klien (prioritas tertinggi)

Saat status ADMITTED diterima, jadwalkan claim setelah
`random(0, min(batch_interval_ms, 8000))` ms, bukan langsung. Tampilkan
"Menyiapkan sesi ujian…" selama jeda. Batas atas 8 dtk aman terhadap
`claim_timeout_ms` 120 dtk.

- Efek: 300 claim menyebar dalam ~8 dtk → ~37/dtk, bukan 300/dtk.
- Ikutan: start, autosave pertama, expiry, dan submit ikut menyebar.
- Risiko: siswa menunggu beberapa detik ekstra; mitigasi dengan indikator.
- Test: unit test fungsi jitter dengan RNG deterministik; pastikan claim
  hanya dipanggil sekali dan tidak melewati deadline.

### D2 — Backoff + jitter polling hasil

Ganti interval tetap 2 dtk dengan backoff penuh:
`2 dtk, 2 dtk, 3 dtk, 4,5 dtk, 6 dtk, 8 dtk, 10 dtk (cap)`, masing-masing
±25% jitter, total hingga ~60–90 dtk. Hormati `submission_state`: selama
`PROCESSING`, boleh tetap 2 dtk; selama `RECEIVED`, pakai backoff lebih
panjang.

- Efek: beban poll turun ~50% dan tidak lagi sinkron antar siswa.
- Risiko: hasil muncul beberapa detik lebih lambat di UI; dapat diterima.
- Opsional server: kirim `Retry-After` pada respons `processing`.

### D3 — Jitter auto-submit saat waktu habis

Di `StudentExam.tsx:64`, tunda `submit(true)` selama `random(0, 2000)` ms
setelah `remaining === 0`. Jawaban setelah expiry tetap ditolak server
(`finalize_only` hanya memfinalisasi yang tersimpan), jadi tidak ada
perubahan semantik. Scanner tetap menjadi jaring pengaman bila tab ditutup.

- Efek: memecah herd 1.200 menjadi ~600/dtk selama 2 dtk; cukup untuk
  menghindari lonjakan TX1 + `waiting.finish`.
- Risiko: kecil; status EXPIRED tetap dihitung dari `expires_at`.

### D4 — Perlebar/phase jitter autosave

Ubah delay flush dari `3000 + rand(0..1000)` menjadi
`2500 + rand(0..3000)` ms (2,5–5,5 dtk), dan tambahkan phase tetap per sesi
siswa (mis. `hash(student_id) % 1000` ms) agar kohort tidak pernah align.
Pertahankan debounce 350 ms, maks 40 jawaban/request, dan satu request
in-flight per siswa.

- Efek: 300 flush menyebar ~3 dtk, bukan ~1 dtk.
- Risiko: jawaban tersimpan paling lambat ~5,85 dtk setelah perubahan;
  indikator "Menyimpan…" sudah ada. Jika terlalu lama, pakai 2,5–4,5 dtk.

### D5 — SSE: tandai perubahan per siswa

Ubah `dirty` dari `Set<examId>` menjadi peta `examId → Set<studentId>`.
Publish menyertakan siswa yang berubah; `release` menyertakan daftar
`released`. Flush hanya membaca klien yang berubah + keepalive. Klien lain
tetap mendapat pembaruan posisi lewat poll 4,5–5,5 dtk.

- Efek: saat release 300, hanya 300 status dibaca, bukan 1.200.
- Risiko: posisi siswa yang tidak di-release bisa tertinggal sampai poll
  berikutnya (≤5,5 dtk); dapat diterima.

### D6 — Pindahkan `waiting.finish` keluar jalur kritis submit

Setelah TX1 commit, panggil `void waiting.finish(...).catch(log)` (atau
`setImmediate`) dan langsung kembalikan `accepted`. Rekonsiler ruang tunggu
sudah memulihkan state dari attempt MySQL setiap 30 dtk, dan `resume`
menangani refresh.

- Efek: response submit tidak lagi menunggu write DB + Lua tambahan.
- Risiko: state FINISHED di Redis/MySQL bisa terlambat beberapa detik;
  tidak mempengaruhi penerimaan, jawaban, atau nilai.

### D7 — Batas admission yang lebih ramah

Turunkan default `claim_timeout_ms` dari 120 dtk ke 60 dtk (masih configurable
per ujian), atau tambahkan pelepasan slot untuk ADMITTED yang melewati
mis. 45 dtk tanpa claim. Opsi kedua lebih adil tetapi menambah kompleksitas
Lua; opsi pertama cukup untuk mencegah stall 2 menit.

- Efek: antrean tidak tertahan lama oleh perangkat yang tidur.
- Risiko: siswa dengan koneksi sangat lambat kehilangan slot lebih cepat;
  mereka bisa join ulang dengan nomor baru (perilaku yang sudah ada).

### D8 — Observability beban

Tambahkan log/metrik agregat (memanfaatkan pola diagnostik yang ada):

- claim: jumlah, p50/p95, error;
- submit: acceptance p50/p95, jumlah `accepted` vs `done`;
- `/result`: jumlah poll dan persentase `processing`;
- admission: release per batch, ADMITTED tanpa claim, umur antrean;
- submission: umur RECEIVED/PROCESSING, jumlah SKIPPED;
- pool: waktu tunggu koneksi (sudah ada di beberapa jalur).

Tidak menambah Prometheus/Grafana baru; cukup log terstruktur + query SQL
runbook yang sudah ada di `docs/ops/submission-async.md`.

## 6. Urutan implementasi yang diusulkan

| # | Perubahan | Dampak | Risiko | Commit |
|---|---|---|---|---|
| 1 | D1 jitter claim | Memutus rantai sinkronisasi utama | Rendah | `feat(arena): spread admission claims with client jitter` |
| 2 | D3 jitter auto-submit + D6 defer finish | Meratakan submit massal | Rendah | `feat(arena): smooth exam submission at expiry` |
| 3 | D2 backoff poll hasil | Menurunkan beban `/result` ~50% | Rendah | `feat(arena): back off result polling with jitter` |
| 4 | D4 phase autosave | Meratakan flush jawaban | Rendah | `perf(arena): spread autosave flush phase` |
| 5 | D5 SSE per siswa | Menurunkan fan-out ruang tunggu | Sedang | `perf(arena): scope waiting-room SSE updates per student` |
| 6 | D7 claim timeout | Mencegah stall admission | Rendah | `fix(arena): bound waiting-room claim timeout` |
| 7 | D8 observability | Verifikasi staging | Rendah | `feat(arena): add load-shape diagnostics` |

D1–D4 murni klien + konstanta, tidak perlu migrasi. D5–D7 menyentuh server
dan perlu test unit/integrasi. Tidak ada perubahan skema.

## 7. Rencana pengujian (tanpa load test)

- **Unit**: fungsi jitter dengan RNG deterministik (batas bawah/atas, sekali
  panggil, tidak melewati deadline); backoff poll (urutan delay, cap, jitter
  ±25%); phase autosave stabil per siswa.
- **Integrasi kecil** (bukan load test): 5–10 request paralel untuk claim dan
  submit ganda; pastikan idempotensi, tidak ada hasil ganda, dan
  `waiting.finish` yang ditunda tetap berakhir FINISHED.
- **Regresi**: seluruh suite API + web yang sudah ada (40 file API, 3 test
  web) harus tetap hijau; `npm run build` bersih.
- **Manual staging** (nanti, bukan sekarang): 1 kelas, amati claim/submit
  menyebar, `/result` tidak menumpuk, dan query invariant Tahap 2 tetap 0.
- **Load test tidak dijalankan pada tahap ini** sesuai instruksi.

## 8. Risiko dan hal yang perlu keputusan

1. Jitter menambah waktu tunggu siswa (claim ≤8 dtk, autosave ≤5,85 dtk,
   hasil lebih lambat beberapa detik). Perlu persetujuan ambangnya.
2. D5 mengubah perilaku SSE; kalau tidak yakin, bisa ditunda dan fokus ke
   D1–D4 yang lebih murah.
3. D7 menurunkan `claim_timeout` default; perlu keputusan apakah 60 dtk cukup
   untuk koneksi sekolah.
4. Login (F9) tidak termasuk paket inti; jika ingin, bisa ditambahkan sebagai
   D9 (jitter login proaktif / tambah worker bcrypt) dengan risiko CPU.
5. Tidak ada perubahan pada penilaian, durasi, snapshot soal, atau data ujian.

## 9. Status akhir

D1–D8 sudah diimplementasikan dan diuji tanpa load test. Production tidak
disentuh: `SUBMIT_ASYNC` tetap `off`, tidak ada migrasi/deploy, dan
`ARENA_LOAD_DIAGNOSTICS` default `false`. Langkah berikutnya adalah verifikasi
staging manual (satu kelas) sebelum mempertimbangkan load test ulang.

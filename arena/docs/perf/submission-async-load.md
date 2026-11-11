# Load test submit asinkron (Tahap 2) — hasil lokal

Pengujian beban untuk jalur **submit asinkron** (TX1 durable acceptance +
scoring di worker) pada MySQL lokal sungguhan. Angka di bawah adalah **pengukuran
lokal**, bukan SLA production dan bukan bukti kapasitas VPS production.

## Metodologi

- Skrip: `apps/api/tests/submission-load-test.mjs` (env-gated, membuat dan
  menghapus data uji sendiri).
- Database: MySQL 8 lokal (InnoDB) di `127.0.0.1:3308`, database `arena`.
- Setiap level membuat cohort sendiri: 1 exam + N siswa + N attempt + snapshot
  soal + 1 jawaban per attempt.
- Submit dikirimkan **bersamaan** lewat route HTTP yang sebenarnya
  (`POST /api/student/exams/:id/submit`, Fastify `inject` — biaya routing +
  CSRF + TX1 terukur, latensi jaringan tidak terukur).
- Setelah acceptance, worker disimulasikan dengan jalur klaim sungguhan
  (`claimSubmission` → `scoring.submit(onBehalfOfSubmission)` →
  `completeSubmission`) pada konkurensi 4.
- Pool MySQL: `connectionLimit=24`, satu proses Node.

Perintah:

```bash
cd arena/apps/api
PW=$(grep '^DATABASE_URL' ../../.env | sed 's|^DATABASE_URL=mysql://arena_app:||; s|@.*||')
ARENA_LOAD_TEST_DB="mysql://arena_app:$PW@127.0.0.1:3308/arena" \
ARENA_LOAD_TEST_LEVELS=100,300,600,1200 node tests/submission-load-test.mjs
```

## Hasil

| Concurrent | Diterima | Error rate | p50 | p95 | p99 | Total acceptance | Throughput acceptance | Selesai (DONE) | Drain | Throughput worker | Hasil (1/attempt) | Deadlock/lock timeout | Invariant |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 100/100 | 0 % | 564 ms | 808 ms | 825 ms | 0,85 s | 118/s | 100 | 1,94 s | 51,5/s | 100 | 0 | 0 |
| 300 | 300/300 | 0 % | 1.075 ms | 1.749 ms | 1.787 ms | 1,82 s | 165/s | 300 | 5,77 s | 52,0/s | 300 | 0 | 0 |
| 600 | 600/600 | 0 % | 1.778 ms | 3.624 ms | 3.736 ms | 3,77 s | 159/s | 600 | 11,45 s | 52,4/s | 600 | 0 | 0 |
| 1.200 | 1.200/1.200 | 0 % | 3.602 ms | 6.353 ms | 6.656 ms | 6,72 s | 179/s | 1.200 | 20,70 s | 58,0/s | 1.200 | 0 | 0 |

Tambahan yang terukur pada semua level:

- `lease_attempts` total = jumlah submission (1 percobaan per submission; tidak
  ada retry, tidak ada takeover).
- Semua submission berakhir `DONE`; tidak ada `SKIPPED`, tidak ada submission
  tertinggal.
- `exam_results` = jumlah attempt dan `COUNT(DISTINCT attempt_id)` = jumlah
  attempt → tidak ada hasil ganda dan tidak ada submission yang hilang.
- Query invariant (A3 §4.3) mengembalikan **0** pelanggaran pada setiap level.
- Koneksi MySQL aktif puncak: 10 dari `connectionLimit=24` (antrian di dalam
  pool proses tunggal).

## Pembacaan hasil

- **Tidak ada satu pun error acceptance** pada 1.200 submit bersamaan: tidak
  ada deadlock, tidak ada lock timeout, tidak ada duplikasi hasil.
- Latensi acceptance naik hampir linear dengan ukuran wave karena antrian di
  dalam pool satu proses; pada produksi ada tiga proses API
  (`infra/ecosystem.config.cjs`) dengan pool 12 per proses, sehingga beban
  acceptance tersebar ke tiga proses dan antrian backlog jauh lebih pendek.
- Throughput worker ~52–58 submission/detik pada konkurensi 4 (satu proses).
  Untuk 1.200 submission, seluruh scoring selesai dalam ~20,7 detik.
- Drain memakai jalur klaim yang sama dengan worker BullMQ; BullMQ hanya
  akselerator antrean, bukan sumber kebenaran, sehingga queue depth Redis tidak
  diukur di sini (Redis tidak dipakai pada skrip ini — dispatcher dilewati
  saat `REDIS_URL` kosong).

## Batas pengujian

- Satu proses Node, satu MySQL lokal, tanpa Redis, tanpa jaringan sungguhan,
  tanpa 3 proses API produksi.
- Skor diukur pada satu soal per attempt (beban scoring minimum realistis).
- Tidak mengukur login, admission waiting room, atau rendering browser.
- Tidak ada uji beban terhadap environment production (dilarang).
- Angka breakdown di atas **tidak boleh dipakai sebagai klaim kapasitas
  production**; klaim tersebut memerlukan rehearsal staging dengan topologi
  produksi (3 proses API + worker + Redis + VPS 4 vCPU).

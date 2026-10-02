# Hasil verifikasi contention CBT — 2 Oktober 2026

## Status

Implementasi dan pengujian correctness selesai pada lingkungan lokal. **Acceptance kapasitas 1.200 siswa produksi belum terpenuhi**, dan seluruh test lama belum hijau karena kegagalan yang sudah ada sebelum edit. Tidak ada angka produksi atau PHP 8.3/FPM yang diklaim dari fixture Windows.

Hasil terkuat: committed duplicate sekarang satu SELECT tanpa explicit transaction/COMMIT; semua pengujian race baru lulus. Transaksi insert menjadi lebih singkat dalam sampel lokal, tetapi waktu end-to-end dan update tidak konsisten lebih cepat. SELECT tambahan adalah tradeoff nyata. Jangan menjadikan patch ini bukti tunggal bahwa bottleneck produksi telah teratasi.

## Lingkungan dan metode

- Windows; PHP 8.1.10 CLI; MySQL 8.0.30 terisolasi `127.0.0.1:13317`; Node 18.8.0. Tidak memakai database aplikasi, .env produksi, atau mengubah konfigurasi MySQL/VPS/Nginx yang sudah ada. MySQL sementara memakai datadir baru dan default durability; dibatasi loopback dan ditutup setelah pengujian.
- Benchmark service: 8 proses PHP/koneksi DB aktif, 1 koneksi pengamat pada snapshot statistik; **100/300/600/1.200 pekerjaan tiba bersama dan mengantre di pool tersebut**. Ini bukan 1.200 query DB aktif bersamaan dan bukan latency HTTP. `p50/p95/p99` mencakup antrean pool+IPC Windows; `service_p95_ms` hanya pekerjaan service di worker, tanpa setup koneksi, auth, CSRF, JSON HTTP, web/FPM.
- 1.200 siswa berbeda, tiga soal snapshot per siswa, dua soal beropsi 16 KB per opsi, empat wave per level: insert, duplicate dari mutation insert, update, unchanged dengan mutation baru. Tidak ada think-time dan bukan simulasi durasi ujian.
- Tiap level mereset data fixture secara terisolasi. Raw [sebelum](benchmarks/contention-before.json) dan [sesudah](benchmarks/contention-after.json) merupakan pasangan run berurutan. Tidak menggunakan run pendahuluan yang sempat bertumpang tindih dengan integration suite.
- Baseline mempertahankan logika AnswerService sebelum perubahan; Database ditambahkan timer yang sama agar `transaction_total_ms`/`commit_ms` dapat dibandingkan. SHA256 baseline AnswerService: `C4C6977F9DE0096E1F2F4CF3353CA577165DBD2A1C5D8054B7161C9F7D93B902`. Sampling timer 100% untuk kedua sisi; default aplikasi tetap 0.
- Satu pasangan run lokal, bukan confidence interval atau benchmark hardware terkontrol. Ada outlier update 100 sesudah (transaction p95 sekitar 81 ms); tetap dilaporkan. Jalur CLI/pipe dan storage host dapat mendominasi. Counter diambil sebagai delta tanpa reset Performance Schema.

## Angka benchmark

[Tabel lengkap p50/p95/p99, transaction p95 dan COMMIT mean](benchmarks/contention-table.md), dengan seluruh metrik dan jumlah COMMIT di JSON mentah.

| Antrean request | Insert transaction p95 ms sebelum → sesudah | Duplicate COMMIT sebelum → sesudah | Error service kedua sisi |
|---:|---:|---:|---:|
| 100 | 15,26 → 7,10 | 100 → 0 | 0% |
| 300 | 11,39 → 7,84 | 300 → 0 | 0% |
| 600 | 9,37 → 5,90 | 600 → 0 | 0% |
| 1.200 | 8,72 → 6,47 | 1.200 → 0 | 0% |

Di setiap wave benchmark service kedua sisi: 8 koneksi worker + 1 pengamat; delta Connections 1 akibat pengambilan statistik akhir; lock waits 0, lock wait time 0. **Nol lock wait pada siswa berbeda tidak membuktikan contention produksi sudah hilang.** Pengujian race/timeout terpisah sengaja menghasilkan lock waits. `COMMIT mean` berasal dari Performance Schema; `commit_p95_ms` dari timer PHP di JSON. Untuk duplicate sesudah, waktu transaksi/COMMIT ditulis null/— karena tidak ada transaksi, bukan latency terukur nol.

Pada 1.200 request: service p95 duplicate 3,22 → 2,87 ms; service p95 update 7,08 → 8,14 ms; insert p95 termasuk antrean 2.275,8 → 2.380,1 ms. Ini alasan tidak mengklaim seluruh autosave lebih cepat. Jalur write baru perlu diuji lagi dengan RTT, storage, proporsi duplicate dan beban nyata sebelum keputusan deployment.

## Pengujian

| Pemeriksaan | Hasil |
|---|---|
| `tests/contention-runner.cjs test` | 71 assertion lulus; koneksi MySQL terpisah; 12 pengulangan writer/writer dan save/submit; forced wait, resume, real 1205 retry |
| `tests/exam-integrity.php` | 78 checks lulus setelah perubahan terakhir; termasuk unchanged timestamp, expired retry, violation/reset, repeated submit, short/MC/multiple-response scoring |
| `tests/transaction-retry.php` | 8 checks lulus; fault injection 1205/1213 rollback partial work, bound 3 attempts, non-PDO tidak retry, logger throwing tidak menggagalkan commit |
| PHP lint aplikasi | Lulus |
| `tests/run.php` | Sebelum **81 pass / 6 fail**; sesudah **81 pass / 6 fail**, nama kegagalan sama |
| Node `*.test.cjs` | 3 file lulus (answer queue, CSRF recovery, follow-up filter); 2 file gagal pada area frontend yang tidak diubah |
| `tests/equations.js` | 30 checks lulus |
| `tests/exam-integrity-signals.js` | 9 checks lulus |
| `tests/frontend/theme.cjs` | Lulus |
| `tests/session-lifecycle.php` | Lulus |
| `tests/portal-sync-schedule.php` | 9 checks lulus |

Kegagalan lama `run.php`: ekspektasi string cache-version pada tablet admin/fetch timeout/answer resilience/portal sync; ukuran `admin-questions.js`; ekspektasi live-session polling. Node: `staff-manual-refresh.test.cjs` mengharapkan interval support-ticket lama; dua kasus `student-dashboard.test.cjs` tidak memuat `renderStudentExamCards`. Berkas produksi/frontend dan test lama ini tidak diedit untuk menyamarkan kegagalan. Enam PHP failure memiliki baseline tersimpan; failure Node berada pada file yang tidak disentuh perubahan ini.

Pengujian concurrency memverifikasi:

1. Insert/update/revision, flagged/unflagged, null, short answer, MC, multiple response, pilihan invalid, membership dan attempt owner.
2. Duplicate identik dan payload mismatch, stale revision, expired, terminated, duplicate sesudah termination.
3. Dua writer dari revision sama: satu sukses, satu 409; nilai persisted sama dengan pemenang, revision tepat satu.
4. Autosave vs submit: hasil 33,33 bila jawaban diterima sebelum submit, 0 bila submit menang; tidak ada jawaban terlambat setelah completed.
5. Mutation sama paralel: satu write + satu duplicate; jawaban antarsiswa tetap terpisah.
6. Writer ditahan oleh lock nyata, blocker mengubah version lalu commit: writer menolak revision lama setelah bangun. Resume pada situasi sama mengembalikan revision baru.
7. Duplicate committed tetap bisa diakui ketika attempt dikunci transaksi lain.
8. MySQL timeout session fixture 1 detik memaksa 1205, lock dilepas pada retry berikutnya: satu kenaikan revision; profile membuktikan retry. Pengujian 1213 bersifat fault injection, **bukan klaim sudah mereproduksi real deadlock**.

## HTTP integration

Runner existing `run-http-mass.cjs`, 8 server bawaan PHP lokal, 3 soal per siswa, melalui auth/CSRF/heartbeat/answer/submit:

- **80 siswa: 80 lulus, 0 gagal**, 1.200 request, 6.466 ms total; p95 keseluruhan 879 ms; autosave endpoint p95 401 ms.
- **1.200 siswa: 656 lulus, 544 gagal**, 15.968 response tercatat, 87.907 ms total; semua 1.200 berhasil start; failure berikutnya berupa `ECONNREFUSED` loopback. p95 response yang tercatat 13.331 ms; autosave p95 5.877 ms. Angka ini tidak menghitung latency request tanpa response dan tidak boleh diperlakukan sebagai benchmark sukses.

Tidak ada fatal/warning/error yang ditemukan pada log PHP fixture 1.200 saat diperiksa. Penyebab TCP refusal belum dibuktikan; tidak mengatribusikannya ke DB, FPM, atau kehabisan port tanpa telemetry pendukung. Ini batas/failure pengujian lokal yang harus ditelusuri di staging. Fixture HTTP adalah server development, bukan target Nginx/FPM. Jangan memakai persentase siswa gagal sebagai error rate request; denominator berbeda.

## Cara menjalankan ulang

Sediakan instance MySQL **khusus disposable** pada loopback port 13317, user fixture root tanpa password (mengikuti harness existing), tidak boleh mengarah ke data nyata. Runner membuat database `cbt_contention_test` dan menolak jika sudah ada; cleanup hanya database miliknya setelah create berhasil. Butuh hak Performance Schema untuk forced-wait/metrics. Tidak memodifikasi atau me-reset statistik server.

```powershell
$env:CBT_TEST_ISOLATED='1'
$env:CBT_TEST_PHP='C:\path\to\php.exe' # gunakan PHP 8.3 pada staging
$env:CBT_PROFILE_SAMPLE_RATE='1'
$env:CBT_TEST_WORKERS='8'
node cbt/tests/contention-runner.cjs test
$env:CBT_BENCH_OUTPUT='C:\path\to\after.json'
node cbt/tests/contention-runner.cjs bench
php cbt/tests/transaction-retry.php
php cbt/tests/exam-integrity.php
```

Baseline: simpan AnswerService versi sebelum patch pada directory terpisah sebagai `AnswerService.php`, serta Database dengan timer saat ini sebagai `Database.php`; set `CBT_CONTENTION_BASELINE` ke directory tersebut saat `bench`. Hapus variabel itu untuk after dan correctness test. Jangan menjalankan baseline/after atau integration DB suite bersamaan. Untuk performa produksi, ulangi sampel lebih banyak dengan PHP 8.3 dan stack representatif; jangan mengekstrapolasi angka Windows ini.

## Berkas perubahan

`AnswerService.php`: preflight/duplicate read-only, re-read setelah barrier, PK version update, phase timers. `Database.php`: optional sampled timing COMMIT/transaction/retry, log setelah transaksi. `TransactionProfile.php`: sampler dan logger tanpa data personal. `ExamSessionService.php`: student read sebelum transaksi untuk snapshot resume yang fresh. Tambahan: harness contention (3 file), fault-injection test, SQL read-only diagnostic, inventory, audit, hasil dan JSON benchmark. Tidak ada migration/schema/config deployment yang diubah.

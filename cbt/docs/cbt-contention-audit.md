# Audit request CBT dan contention — 2 Oktober 2026

## Kesimpulan dan batas bukti

Lock attempt bersifat per `(student_id,exam_id)`, bukan satu lock ujian untuk 1.200 siswa. EXPLAIN fixture MySQL 8.0.30 memilih `uq_attempt_student_exam`, estimasi satu baris. Data pengguna (31.931 COMMIT / 49.823 detik; 22.573 row waits / 33.062.965 ms) menunjukkan waktu COMMIT dan lock wait besar, tetapi belum mengidentifikasi blocker, interval pengamatan, atau endpoint penyebab. Counter kumulatif antarthread tidak boleh dibaca sebagai waktu wall-clock atau dijumlahkan sebagai komponen request yang sama. `Innodb_log_waits=0` tidak menyingkirkan latency fsync/binlog COMMIT. Buffer pool rendah tidak membuktikan bottleneck disk ataupun kapasitas 1.200 siswa.

Kode awal sudah memproyeksikan keberadaan opsi, melewati UPDATE jawaban identik, memakai unique key, melepaskan session PHP di middleware auth, menjitter heartbeat, serta melakukan rendering resume setelah COMMIT. Ini bukan optimasi baru dalam perubahan ini.

Prioritas implementasi: duplicate tanpa transaksi, validasi statis sebelum lock, UPDATE versi existing dengan PK, observabilitas ringan, dan snapshot resume yang benar. Lock attempt dipertahankan. Tidak ada cache jawaban, konfigurasi server, isolation global, FK/unique/index yang dihapus, atau queue penyimpanan server baru.

**Batas:** save baru menambah satu SELECT. Optimasi ini mengurangi pekerjaan di critical section, bukan menjamin semua jenis save lebih cepat. Benchmark lokal menggunakan PHP 8.1.10, MySQL 8.0.30 Windows, worker terbatas; belum merupakan validasi PHP 8.3/Nginx/FPM atau sertifikasi 1.200 siswa produksi. Hasil ada di [laporan benchmark](cbt-contention-results.md).

## Cakupan pencarian

Seluruh `cbt/app`, `cbt/public`, `cbt/scripts`, `cbt/database`, dan `cbt/tests` diperiksa untuk beginTransaction, START TRANSACTION, FOR UPDATE, LOCK IN SHARE MODE, commit, rollBack, student_answers, answer_write_versions, exam_attempts, attempt_questions, attempt_connections, violations, submit, heartbeat, autosave. Daftar lokasi transaksi produksi berada di [inventory](cbt-contention-transactions.txt). `public/index.php.backup-before-session-release` adalah backup, bukan entry point aktif. Seed/migrasi hanya operasional CLI; bukan autosave.

## Flow request dan frekuensi

Semua route aktif berasal dari `public/index.php`. Bootstrap membuka sesi; koneksi Database dibuat sebelum middleware. Auth memeriksa session dan status akun (SELECT PK pada cache miss, TTL existing 10 detik); kemudian melepaskan lock session. CSRF tetap diperiksa. Masing-masing request memakai koneksi PDO nonpersistent. Membuka 1.200 request tidak sama dengan 1.200 koneksi aktif: antrean web/FPM menentukan jumlah worker.

| Endpoint | Frekuensi dari kode frontend | Query service / transaksi | Lock dan durasi teoretis | Peluang dan risiko |
|---|---|---|---|---|
| PUT `/api/student/exams/{id}/answers/{questionId}` | Setiap perubahan jawaban/flag; antrean satu request in-flight per tab; retry 5–7 s; jumlah aktual perlu telemetry | Awal: BEGIN, attempt FOR UPDATE, JOIN snapshot+version+answer, optional answer INSERT/UPDATE, version UPSERT, COMMIT. Akhir: preflight nonlocking; duplicate selesai; write BEGIN, attempt lock, JOIN state kecil, optional answer write, version INSERT/UPDATE, COMMIT | X pada attempt milik siswa; answer/version yang ditulis; S parent FK saat INSERT. T = begin + tunggu lock + query + validasi/CPU + write + commit. Retry bisa tiga kali lock timeout, bukan dibatasi 45 s timeout browser | Validasi statis keluar transaksi; state mutable wajib dibaca ulang setelah lock. Melepas lock tanpa barrier submit memungkinkan jawaban masuk setelah penilaian. |
| POST `.../heartbeat` | Langsung saat mulai; tiap 45–60 s jitter (~20–27 request/s untuk 1.200 siswa) | Existing cache presence 40 s; miss: SELECT attempt LEFT JOIN connection; bila lama INSERT connection ON DUPLICATE UPDATE. Autocommit, bukan transaction callback | X connection; insert dapat meminta S parent attempt. Satu write statement termasuk COMMIT. Heartbeat yang lewat deadline/submit antara SELECT dan write hanya memperbarui presence | Tidak menulis status/jawaban; approximate presence boleh stale. Jangan gabung INSERT SELECT yang mengunci sumber tanpa pengukuran. Cache existing tidak menyimpan jawaban. |
| POST `.../violations` | Event fokus/fullscreen/copy dll; bukan polling. Rate 20/60 s per siswa+exam | Rate fallback UPSERT+SELECT di luar transaksi; BEGIN attempt SELECT * FOR UPDATE, INSERT IGNORE violation, UPDATE attempt counter/status, COMMIT; middleware audit INSERT autocommit. Pelanggaran ke-3 memanggil submit dalam transaksi kedua | X attempt dan unique `(attempt,event)`; counter/status harus atomic. T = lock + insert + counter update + commit, ditambah submit jika terminate | Event validation/ULID dapat dipindah keluar; kolom attempt dapat dipersempit. INSERT IGNORE berisiko menyamarkan error lain; tidak diubah dalam optimasi ini. Jangan lepas lock counter atau gabung scoring menjadi transaksi lebih besar. |
| POST `.../submit` | Satu akhir ujian; retry idempotent; rate 8/60 s | Rate fallback; BEGIN lock attempt, SELECT result, SELECT keberadaan snapshot (legacy mungkin INSERT SELECT), SELECT snapshot LEFT JOIN answers, SELECT metadata remedial (+ setting bila perlu), INSERT result, UPDATE attempt, COMMIT; audit terpisah | X attempt selama seluruh scoring. Legacy copy dapat S-lock bank soal; result INSERT S-parent attempt. T bertambah O(jumlah soal), pengiriman opsi multiple-response, scoring dan COMMIT | Jangan pindahkan answer read/scoring keluar barrier tanpa finalization protocol. Proyeksi jumlah opsi dapat diperkecil nanti dengan uji kesetaraan whitespace PHP/SQL. Existing result branch tetap ada query metadata. |
| POST `.../start` (start/resume) | Awal masuk/refresh/reconnect; tidak setiap autosave | Controller recover: SELECT attempt + result; jika due submit. Service: student SELECT, BEGIN attempt FOR UPDATE; exam shared read (eligibility, mungkin SHOW TABLES); baru: IDs + INSERT attempt + read kembali + INSERT SELECT snapshot per 100 IDs; SELECT snapshot, SELECT answers+versions; COMMIT; render HTML di luar | X attempt, S exam; start missing unique entry bisa gap lock; INSERT snapshot memegang locks sampai seluruh snapshot selesai. T = O(soal/payload) + commit | Perubahan ini memindahkan student SELECT sebelum BEGIN agar tidak membuat RR read view sebelum lock. Payload/answers tetap di dalam untuk konsistensi resume; memindahkan terpisah butuh read-view yang dirancang. Dua start bersamaan dapat deadlock lalu retry. |
| POST `/api/auth/student/login` | Satu login awal; burst 1.200 siswa | CSRF; network rate fallback UPSERT+SELECT; account rate fallback UPSERT+SELECT; student SELECT; password_verify; regenerate/close session; audit INSERT. Tidak ada explicit tx | Autocommit X pada rate bucket, audit insert; network bucket berbagi IP adalah kandidat hotspot lintas siswa. Password hashing CPU di luar DB transaction | Pertahankan security. Mengubah rate semantics, menghapus limit IP, atau memperbesar concurrency bukan solusi tanpa bukti. Redis existing bukan persyaratan baru. |
| GET `/api/student/exams`, `/api/auth/me` | Dashboard sekitar 60–90 s, me untuk bootstrap/recovery | Status siswa, metadata/eligibility, attempt LEFT JOIN; me status akun dan token; normal nonlocking | Tidak ada X row lock; CPU/query/read I/O | Jangan cache seluruh personal response. Query visibility memuat e.*; perbaikan proyeksi dapat diuji terpisah. |
| GET `.../review` / cron `finalize-exams.php` | Review sesudah selesai; cron batch 200 default | Review SELECT attempt/snapshot/jawaban, legacy snapshot repair; cron mencari due tanpa lock lalu submit masing-masing | Cron berbagi barrier submit; review legacy INSERT SELECT bisa menambah write | Jalankan batch terukur; jangan membuat satu transaksi mencakup seluruh siswa. |

Tambahkan auth miss SELECT pada hitungan query protected endpoint. Audit login/submit/violation yang sudah ada dipertahankan; instrumentation baru tidak INSERT ke audit/database. Connection setup `SET time_zone` juga satu round trip per request dan berada di luar pengukuran service benchmark.

## Penulis lain dan urutan lock

| Jalur | Transaksi/lock relevan | Dampak |
|---|---|---|
| Admin terminate siswa/ujian | lock attempt(s) -> UPDATE exam (batch ujian) -> UPDATE attempt | Banyak attempt terkunci sampai commit batch; dapat menahan autosave. |
| AttemptResetService / support-ticket reset | baca otorisasi -> lock attempt -> S exam/student -> baca pelanggaran/result -> audit -> DELETE result -> UPDATE attempt | Mempertahankan jawaban/versi/identitas; reset tidak menciptakan attempt baru. Pembacaan otorisasi sebelum lock masih dapat membuat read-view lama untuk result audit; dicatat untuk perbaikan terpisah. |
| Admin exam delete/status/follow-up | exam FOR UPDATE; cloning/copy questions; global setting `follow_up_schedule_lock` FOR UPDATE dan S-lock jadwal | Ada urutan exam -> attempt melalui perubahan/deletion/FK, berbeda dari start/reset attempt -> exam. Deadlock mungkin; jangan mengedit/migrasi bank soal saat beban ujian tanpa memeriksa blocker. |
| Edit/import questions | UPDATE bank soal dalam batch transaksi | S FK autosave insert/version insert ke `questions(id)` dapat menunggu X bank soal. Snapshot isi siswa tetap immutable pada flow normal. |
| Portal sync / admin siswa | batch upsert student/teacher/employee dan deactivate | FK/validasi akun dapat bersaing; transaksi batch besar bukan autosave. |
| Support tickets | student FOR UPDATE, duplicate ticket FOR UPDATE; resolve ticket lock dan reset | Bisa berinteraksi dengan FK attempt/student; bukan request frekuensi autosave. |
| StaffAdminCommunication | INSERT thread/message; reply UPDATE thread dalam tx | Terpisah dari attempt, tetapi memakai I/O COMMIT yang sama. |

Foreign key dapat mengambil shared record locks pada parent; shared locks antarsiswa kompatibel, tetapi tidak dengan writer eksklusif. Unique attempt lookup yang ditemukan mengunci record, bukan seluruh tabel. Missing record/gap, duplicate key, secondary indexes, foreign key, serta metadata DDL tetap perlu diamati. Rujukan: [MySQL locks set by statements](https://dev.mysql.com/doc/refman/8.0/en/innodb-locks-set.html), [MySQL isolation/read view](https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-isolation-levels.html).

## Query dan flow sebelum/sesudah

Sebelum, insert/update jawaban normal: **4 SQL service + BEGIN/COMMIT**. Unchanged: 3 SQL + BEGIN/COMMIT. Duplicate: 2 SELECT + BEGIN/COMMIT.

```text
BEGIN -> attempt X lock -> snapshot options + answer + revision
      -> normalize/validate -> duplicate/status/expiry/revision checks
      -> optional answer INSERT/UPDATE -> version UPSERT -> COMMIT
```

Sesudah, insert/update normal: **5 SQL service + BEGIN/COMMIT**; unchanged: 4 SQL + BEGIN/COMMIT; committed duplicate: **1 SELECT, tanpa explicit transaction/write**. Duplicate yang baru terlihat setelah menunggu lock tetap memakai transaksi fallback.

```text
SELECT attempt + snapshot option availability + answer + revision (autocommit)
  -> ownership/membership/normalize/validate
  -> matching duplicate: return
BEGIN -> attempt X lock -> identity recheck -> SELECT membership + answer + revision
      -> duplicate/status/expiry/revision checks
      -> optional answer INSERT/UPDATE -> version INSERT or UPDATE PK -> COMMIT
```

```sql
-- Sebelum (selalu insert/duplicate path):
INSERT INTO answer_write_versions(attempt_id,question_id,revision,mutation_id)
VALUES(:attempt,:question,:revision,:mutation)
ON DUPLICATE KEY UPDATE revision=VALUES(revision),mutation_id=VALUES(mutation_id);

-- Sesudah, existing row: key/FK tidak berubah.
UPDATE answer_write_versions SET revision=:revision,mutation_id=:mutation
WHERE attempt_id=:attempt AND question_id=:question;
-- Absent row: plain INSERT, masih dilindungi attempt lock dan PK.
```

Tidak mengganti answer UPDATE dengan UPSERT: PK answer sudah diketahui dan unchanged tidak perlu mengubah `answered_at`. Tidak menggabungkan answer/version menjadi satu multi-statement request; jumlah write tetap dua untuk perubahan nyata demi kontrak schema saat ini. Preflight tidak membaca `question_text`, isi opsi, kunci jawaban, ataupun JSON urutan soal ke PHP; ekspresi SQL masih dapat mengakses LOB di server sebelum lock. Metadata snapshot bukan cache dan tidak dibagikan antar siswa.

## Bukti correctness dan batas desain

1. Semua writer jawaban baru mengunci attempt yang sama dengan submit/violation/admin terminate. Jika save menang, submit membaca commit save; jika submit menang, save melihat status closed dan menolak. Expiry diperiksa setelah lock, bukan berdasarkan preflight.
2. Transaction autosave tidak memiliki consistent read sebelum attempt lock. Dalam RR, SELECT state setelah lock melihat commit writer sebelumnya. Retry membuka transaction/read view baru. Versi/answer selalu ditulis dalam satu commit.
3. Dua request dengan base revision sama: hanya satu dapat advance; yang lain 409. Mutation sama+payload sama diakui sebagai duplicate; payload berbeda 409. Tidak ada silent rebase dua tab/device.
4. Fast duplicate linearizes pada SELECT autocommit tunggal: hanya mengakui mutation yang sudah committed, tidak mengubah state. Save/submit yang overlap sesudah SELECT dapat diurutkan setelah duplicate. Duplicate setelah expired/terminated tetap diakui seperti API lama.
5. Owner berasal dari authenticated student+exam. Public ID diperiksa di preflight dan setelah lock; internal ID dibandingkan lagi. Snapshot/answer/version selalu di-scope attempt+question. Attempt yang dihapus/diganti di antara preflight/lock tidak dapat memakai metadata lama.
6. Validasi statis di luar lock mengandalkan snapshot attempt immutable pada jalur aplikasi normal. Migrasi/manual SQL yang mengubah snapshot aktif harus offline; bila kelak ada fitur edit snapshot, fitur tersebut harus memperkenalkan revision snapshot/revalidation sebelum write. Reset saat ini tidak mengubah snapshot.
7. Retry 1205/1213 tetap maksimum dua retry setelah percobaan awal, rollback sebelum jitter 10–40 ms; callback hanya mutasi DB. Tidak retry kegagalan koneksi/COMMIT ambigu otomatis: klien tetap mengirim mutation ID yang sama untuk recovery.
8. Atomic optimistic version check tetap digunakan di bawah barrier attempt. Pure CAS per soal belum dipilih: selain lost update soal, diperlukan barrier status/submit, kondisi absent row, FK parent lock upgrade, serta consistent scoring. Menukar X attempt menjadi shared lock tanpa menguji semua writer dapat membawa deadlock/upgrade baru.

## Profiling yang ditambahkan

`CBT_PROFILE_SAMPLE_RATE` default `0` (mati); set aplikasi misalnya `0.01` untuk sampel 1%. Tidak ada konfigurasi VPS/MySQL/Nginx yang diubah. Log `CBT_PROFILE {...}` memakai PHP error log, **setelah** commit/rollback, tanpa answer/mutation/student/SQL. Rate `1` hanya digunakan harness fixture. Atur retensi log melalui mekanisme operasional yang sudah ada.

Fields: `total_ms`, `question_validation_ms` (SQL+normalisasi), `lock_attempt_ms` (round trip+execute+fetch+wait, bukan lock-only), `answer_state_ms`, `answer_write_ms`, `version_write_ms`, `commit_ms`, `transaction_total_ms`, `retries`, outcome. Timer phase dijumlahkan lintas retry; transaction_total mencakup BEGIN, rollback dan backoff. Transaction lain diberi operation `transaction`, tidak otomatis membedakan endpoint; korelasikan dengan access log/route pada pengukuran lanjutan. Tidak menambah query profiling per request.

Gunakan [SQL diagnostik read-only](../scripts/profile-contention.sql) untuk dua snapshot counter pada interval sama dan sampel live `data_lock_waits` saat beban. Tidak mereset Performance Schema. Digest/COMMIT global bisa tercampur workload lain; pisahkan instance staging atau tandai keterbatasan. `EXPLAIN ANALYZE` mengeksekusi query: gunakan hanya read-only fixture, bukan locking read/live write. EXPLAIN fixture membuktikan lookup attempt, snapshot, version, answer via unique/primary key, bukan membuktikan latency produksi.

## Verifikasi dan langkah berikutnya

Test baru menggunakan koneksi MySQL berbeda, termasuk lock wait yang benar-benar terlihat di Performance Schema, bukan hanya Promise yang kebetulan berjalan berurutan. Ada insert/update, null+flag/unflag, MC/short/multiple-response, duplicate dan mismatch, stale, expired/terminated, dua siswa, dua writers, submit race, resume menunggu writer, serta retry lock timeout nyata. Suite lama menjaga timestamp unchanged, legacy snapshots, repeated submit dan reset. Detail hasil/limit ada di laporan benchmark.

Lanjutkan pengukuran pada staging PHP 8.3 + FPM yang menyerupai produksi: distribusi save baru/duplicate realistis, ukuran snapshot nyata, jitter/polling/violation, burst login satu IP, autosave+heartbeat+submit campuran. Catat antrean FPM, request latency, transaction dan commit, koneksi, error rate serta pasangan blocker/waiter. Tentukan SLO dahulu; 1.200 pengguna tanpa interval think-time bukan angka request/s. Jangan meningkatkan worker/server concurrency hanya agar label benchmark terlihat besar.

Jika COMMIT tetap dominan, identifikasi await fsync/binlog dan workload lain tanpa menurunkan durability. Jika `rate_limits` terbukti hotspot, evaluasi desain atomic rate limiting sesuai topologi yang sudah tersedia tanpa melemahkan batas keamanan. Jika bank soal/administrasi menjadi blocker, pendekkan transaksi admin dan perbaiki urutan lock dengan pengujian terpisah. Jika save baru lambat akibat preflight tambahan, hasil ini menjadi alasan mengukur tradeoff atau memilih proyeksi metadata tersimpan/versioned; jangan mengklaim seluruh autosave sudah lebih cepat.

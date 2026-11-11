# Submit Ujian Asinkron (Tahap 2) — runbook operasional

Dokumen ini adalah acuan aktivasi, pemantauan, dan rollback fitur **submit
asinkron**. Fitur ini **belum aktif di production**: `SUBMIT_ASYNC=off` sampai
staging lulus load test dan tinjauan operasional.

## 1. Ringkas mekanisme

| Komponen | Peran | Sumber kebenaran |
|---|---|---|
| `exam_submissions` (tabel MySQL) | Catat penerimaan submission durable | **Ya** — satu-satunya kebenaran |
| `exam_attempts.submitted_at` | Penanda beku jawaban (freeze) | Ya |
| `exam_results` | Border idempotensi hasil (1 hasil per attempt) | Ya |
| BullMQ `arena-finalization` | Akselerator eksekusi scoring | Tidak — kegagalan enqueue tidak menghilangkan pekerjaan |

Alur:

1. `POST /api/student/exams/:id/submit` menjalankan **TX1**:
   attempt `FOR UPDATE` → fast-path `exam_results` → guard status → set
   `submitted_at` → `INSERT exam_submissions (state=RECEIVED)` → `COMMIT`.
   **Commit TX1 = batas penerimaan durable.** Setelah commit, autosave ditolak
   409 dan jawaban dibekukan.
2. Respons HTTP: `{status:'accepted', submission_state:'RECEIVED'}` — bukan
   "nilai sudah keluar".
3. Worker mengklaim submission (`claim_token` + `lease_expires_at`), memperbarui
   lease, menilai dengan `onBehalfOfSubmission`, lalu menandai `DONE` bila token
   masih cocok.
4. `GET /api/student/exams/:id/result` mengembalikan `200 {status:'processing'}`
   selama submission `RECEIVED`/`PROCESSING`; setelah selesai mengembalikan
   hasil biasa. Frontend mem-poll tiap 2 detik (maks 40 detik).

State submission: `RECEIVED → PROCESSING → DONE | SKIPPED`.

## 2. Aktivasi di staging (urutan wajib)

1. **Migrasi 016 lebih dulu** (kode boleh menyusul; kode lama tidak membaca
   kolom/tabel baru):

   ```bash
   mysql -u arena_migrator -p "$ARENA_DB" < database/migrations/016_exam_submissions.sql
   mysql -u arena_migrator -p "$ARENA_DB" -e "
     SHOW COLUMNS FROM exam_submissions;
     SHOW COLUMNS FROM exam_attempts LIKE 'submitted_at';"
   ```

   Migrasi idempotent (aman diulang) dan aditif. Rollback:
   `database/rollbacks/016_exam_submissions.sql` — jalankan **hanya** setelah
   kode yang membaca tabel/kolom ini sudah dilepas (lihat §6).

2. **Build & restart** worker dan API:

   ```bash
   cd /srv/repos/portal-data-man/arena
   npm ci && npm run build
   pm2 startOrReload infra/ecosystem.config.cjs
   pm2 logs arena-finalization --lines 50
   ```

3. **Aktifkan flag** hanya di staging — `SUBMIT_ASYNC=on` pada proses `arena-api`
   (file `.env` staging). `infra/ecosystem.config.cjs` production tetap
   `SUBMIT_ASYNC='off'` sampai ada persetujuan aktivasi.

4. **Verifikasi** (lihat §4).

> Bila migrasi 016 belum ada, route `/submit` otomatis jatuh ke jalur sinkron
> lama (`ER_NO_SUCH_TABLE`/`ER_BAD_FIELD_ERROR` → fallback), dan `/result`
> memakai query tanpa join submission. Jadi urutan migrasi-dulu aman.

## 3. Parameter lingkungan

| Variabel | Default | Arti |
|---|---|---|
| `SUBMIT_ASYNC` | `off` | `on` = TX1 asinkron + scoring di worker |
| `SUBMIT_LEASE_MS` | `60000` | Durasi lease klaim (clamp 5.000–600.000 ms) |
| `SUBMIT_LEASE_MAX_ATTEMPTS` | `5` | Batas percobaan klaim (clamp 1–20) |
| `FINALIZATION_CONCURRENCY` | `4` | Jumlah job finalisasi paralel per worker |

Lease diperpanjang otomatis setiap `lease/3`. Setelah `lease_attempts` mencapai
batas, submission menjadi `SKIPPED` dengan `skip_reason='lease_exhausted'` dan
**tidak** diproses ulang tanpa tindakan admin (butuh jalur re-arm di tahap
berikutnya).

## 4. Query verifikasi & pemantauan

### 4.1 Invariant state (jalankan berkala, harus kosong)

```sql
SELECT s.attempt_id, s.state, s.skip_reason, a.status, a.submitted_at,
       (r.id IS NOT NULL) AS has_result
FROM exam_submissions s
JOIN exam_attempts a ON a.id = s.attempt_id
LEFT JOIN exam_results r ON r.attempt_id = s.attempt_id
WHERE (s.state='DONE'          AND (r.id IS NULL OR a.submitted_at IS NULL))
   OR (s.state IN ('RECEIVED','PROCESSING') AND a.submitted_at IS NULL)
   OR (s.state='PROCESSING'   AND (s.claim_token IS NULL OR s.lease_expires_at IS NULL))
   OR (s.state='SKIPPED' AND s.skip_reason='lock'
       AND a.termination_action IS DISTINCT FROM 'LOCK');
```

Makna tiap pelanggaran:

| Pelanggaran | Deteksi | Pemulihan |
|---|---|---|
| `DONE` tanpa hasil | Arm self-heal otomatis (1 jam) | Kembalikan ke `RECEIVED`, `lease_attempts=0` |
| `RECEIVED/PROCESSING` tanpa `submitted_at` | Invariant I1 | Klaim worker akan men-set `submitted_at` (COALESCE) |
| `PROCESSING` tanpa token/lease | Worker mati saat bekerja | Reconciler mengambil alih setelah lease kedaluwarsa |
| `SKIPPED(lock)` tanpa `termination_action='LOCK'` | Bug (tidak mungkin terjadi) | Alarm, bukan auto-heal |

### 4.2 Pantau antrean & macet

```sql
-- submission yang menunggu terlalu lama (antrian/reconciler macet)
SELECT state, COUNT(*) n, MIN(received_at) oldest
FROM exam_submissions
WHERE state IN ('RECEIVED','PROCESSING')
GROUP BY state;

-- submission yang gagal diproses (butuh tindakan admin)
SELECT attempt_id, state, skip_reason, lease_attempts, received_at, finalized_at
FROM exam_submissions
WHERE state='SKIPPED'
ORDER BY finalized_at DESC;

-- attempt beku tanpa submission (journal rollback versi lama)
SELECT a.id, a.student_id, a.exam_id, a.submitted_at
FROM exam_attempts a
WHERE a.submitted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM exam_submissions s WHERE s.attempt_id = a.id);
```

Kasus terakhir memang dapat muncul bila kode versi lama (tanpa 016) menulis
`submitted_at`; arm self-heal dan TX1 berikutnya menutupnya dengan COALESCE.

### 4.3 Bukti hasil (setelah load test)

```sql
SELECT COUNT(*) attempts, COUNT(DISTINCT r.attempt_id) results
FROM exam_attempts a LEFT JOIN exam_results r ON r.attempt_id = a.id
WHERE a.exam_id = ?;
```

`attempts = results` berarti tidak ada hasil ganda dan tidak ada submission
yang hilang.

## 5. Aktivasi bertahap yang disarankan

1. Migrasi 016 di staging, `SUBMIT_ASYNC=off` (jalur lama, schema sudah ada).
2. Jalankan load test staging (100 → 300 → 600 → 1.200 concurrent) dan cocokkan
   dengan query invariant §4.
3. `SUBMIT_ASYNC=on` di staging; ulangi uji dengan siswa sungguhan (1 kelas).
4. Monitoring 1 siklus ujian penuh: cek §4.1, `SKIPPED`, dan latensi `/result`.
5. Baru pertimbangkan production — **memerlukan persetujuan terpisah**; dokumen
   ini tidak mengaktifkan apa pun di production.

## 6. Rollback

1. Set `SUBMIT_ASYNC=off` pada proses `arena-api` dan `pm2 reload arena-api`.
   Jalur sinkron lama langsung aktif kembali; submission yang masih `RECEIVED`
   tetap diproses oleh worker/reconciler (MySQL tetap sumber kebenaran).
2. Hentikan worker bila perlu: `pm2 stop arena-finalization`.
3. Jangan rollback tabel selama masih ada submission `RECEIVED/PROCESSING`:
   `DROP TABLE exam_submissions` akan menghapus jejak durable submission yang
   masih menunggu. Tunggu sampai semua submission `DONE`/`SKIPPED`.
4. Bila migrasi tetap harus dibatalkan (kode lama total):
   ```bash
   mysql -u arena_migrator -p "$ARENA_DB" < database/rollbacks/016_exam_submissions.sql
   ```
   Rollback ini menghapus tabel `exam_submissions` dan kolom
   `exam_attempts.submitted_at`. Attempt terkait yang belum punya hasil akan
   dipulihkan oleh scanner expired lama. **Tidak ada data jawaban/hasil yang
   dihapus.**
5. Verifikasi ulang: `SHOW COLUMNS FROM exam_attempts LIKE 'submitted_at';`
   harus kosong, dan `SELECT COUNT(*) FROM exam_results;` tidak berubah.

## 7. Batas yang diketahui

- `SKIPPED` (`lease_exhausted`, `snapshot_missing`, `lock`) tidak punya pemulihan
  otomatis — butuh tindakan admin; jalur re-arm direncanakan di tahap
  berikutnya.
- BullMQ bukan sumber kebenaran; Redis down hanya menambah latensi (reconciler
  mengirim ulang tiap tick scanner), tidak menghilangkan submission.
- `waiting.finish` dipanggil setelah TX1, sehingga transisi ruang tunggu
  terjadi lebih awal daripada versi sinkron lama.
- Angka latensi pada load test lokal adalah pengukuran lokal, bukan SLA
  production.

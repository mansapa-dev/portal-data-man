# Arena CBT — Optimasi Aman Rekaman Sebelum Ujian

Tanggal: 26 November 2026
Target: ujian ±1.200 siswa, 07:00 WIB
Status: **perubahan hanya di repository lokal. Tidak ada deploy, restart, migrasi, atau perubahan production.**

---

## 1. Arsitektur yang diperiksa

| Komponen | Lokasi |
|---|---|
| API recording | `arena/apps/api/src/routes/recording.ts` |
| Object Storage (S3/Linode) | `arena/apps/api/src/services/object-storage.ts` |
| Policy & readiness | `arena/apps/api/src/services/recording-policy.ts` |
| Cleanup retensi | `arena/apps/api/src/recording-cleanup-worker.ts` |
| Security events | `arena/apps/api/src/routes/security-events.ts` |
| Monitoring staff | `arena/apps/api/src/routes/staff-monitoring.ts` |
| Recorder browser | `arena/apps/web/src/lib/recorder.ts` |
| Upload queue | `arena/apps/web/src/lib/upload-queue.ts` |
| Kemampuan perangkat | `arena/apps/web/src/lib/device-capability.ts` |
| Preflight | `arena/apps/web/src/lib/preflight-policy.ts`, `ExamPreflight.tsx` |
| Integrasi ujian | `arena/apps/web/src/StudentExam.tsx` |
| Skema | `arena/database/migrations/021`–`025` |
| Test | `arena/apps/api/tests/recording-security.test.mjs`, `arena/apps/web/tests/recording-preflight.test.mjs` |

Infrastruktur production mengikuti konteks owner: VPS 4 vCPU / ±8 GB RAM, MySQL 8, Redis, Nginx, PM2 (`arena-pm2.service`), Cloudflare, bucket `cbt` di `id-cgk-1.linodeobjects.com`. Env production tidak diakses dan tidak diubah.

---

## 2. Implementasi rekaman saat ini

- `StudentExam.tsx` menyalakan `createExamRecorder()` saat ujian dibuka dan merekam **terus-menerus** selama attempt aktif, bukan hanya saat event.
- Segmen dipotong setiap `RECORDING_SEGMENT_DURATION_SECONDS` (default **60 detik**), video-only, bitrate dari policy (default **500 kbps**), memakai stream kamera yang sama dengan face presence.
- Segmen disimpan ke IndexedDB sebelum diunggah, lalu `PUT` langsung ke Object Storage memakai presigned URL.
- Konfirmasi memakai `HEAD Object`; sesi difinalisasi saat submit/expiry dengan retensi 7 hari.
- Cleanup worker menghapus objek `UPLOADED` setelah `retain_until` dan menghormati `legal_hold`.

**Penting:** repo sendiri memperingatkan agar `RECORDING_ENABLED=true` tidak dipakai di production sebelum validasi staging (`arena/docs/ops/recording-admission-architecture.md`). Status env production **tidak dapat diverifikasi** dari environment ini.

---

## 3. Temuan audit (masalah spesifik rekaman)

1. **Continuous ≠ event-based.** Tidak ada trigger event, cooldown, dedupe klip, atau batas klip per attempt. Ini penyebab biaya terbesar (lihat dokumen estimasi: continuous 120 menit ≈ 540 GB vs 5 klip event ≈ 11,25 GB).
2. **Segmen default 60 detik**, bukan target 30 detik. `MAX_SEGMENTS_PER_SESSION=300` berarti 5 jam pada 60 detik.
3. **IDOR evidence staff.** `GET /api/teacher/recording/:attemptPublicId` dan `GET /api/teacher/recording/segment/:segmentId/url` hanya mengecek role, tanpa scope penugasan ujian. Guru yang tidak ditugaskan bisa melihat/mendapat URL playback.
4. **Evidence bisa ditimpa.** Permintaan presigned URL untuk segmen yang sudah `UPLOADED` mengembalikan URL `PUT` baru untuk object key yang sama, sehingga klip yang sudah dikonfirmasi bisa ditimpa.
5. **Tidak ada batas ukuran objek.** `HEAD contentLength` disimpan tanpa cap; body `file_size_bytes` hingga 500 MB diabaikan. Objek oversized tidak dihapus → biaya storage liar.
6. **Upload tanpa timeout.** `fetch(PUT)` bisa menggantung dan memblokir antrean sampai reload.
7. **Burst upload tersinkron.** Semua siswa mulai bersamaan; batas segmen 60 detik membuat 1.200 upload terjadi pada detik yang hampir sama tanpa jitter awal.
8. **Env tidak divalidasi.** Nilai `0`, negatif, `NaN`, atau bitrate sangat besar bisa membuat loop recorder/bitrate tak terkendali.
9. **Resolusi bukan 360p.** Stream kamera preflight meminta ideal 640×480 (maks 1280×720). `RECORDING_RESOLUTION` dan `RECORDING_FPS` tidak dibaca kode. Ukuran file tetap dikendalikan bitrate.
10. **Risiko playability segmen.** Recorder memakai `requestData()` pada MediaRecorder yang sama; chunk setelah segmen pertama belum tentu bisa diputar mandiri. Tidak diubah karena butuh desain stop/restart dan uji perangkat.
11. **Orphan object.** Cleanup hanya menghapus segmen `UPLOADED`; objek `PENDING`/`FAILED` (termasuk upload yang tidak pernah dikonfirmasi) tidak pernah dibersihkan. Tidak diubah untuk menghindari penghapusan evidence yang salah.
12. **Endpoint policy tanpa validasi attempt.** `GET /api/student/recording/policy` hanya mengembalikan policy non-rahasia; dampak rendah, tidak diubah.
13. **Klaim rekaman aktif tidak bisa dibuktikan** tanpa akses env/bucket production.

---

## 4. Optimasi minimal yang diimplementasikan

### 4.1 API

| Perubahan | Perilaku baru |
|---|---|
| Batas ukuran segmen | `HEAD` > `RECORDING_MAX_SEGMENT_BYTES` (default 8 MiB) → objek dihapus best-effort, baris ditandai `FAILED`, respons `413`. |
| Proteksi overwrite | Segmen `UPLOADED` tidak lagi diberi URL `PUT`; respons `already_uploaded: true`, `upload_url: ""`. |
| Scope staff | Non-ADMIN harus punya penugasan ujian atau menjadi proctor global (`PROCTOR`, `exam_id NULL`) untuk list/playback. ADMIN tetap bebas. |
| Batas configurable | `RECORDING_MAX_SEGMENT_BYTES`, `RECORDING_MAX_SEGMENTS_PER_SESSION`, retensi dan durasi divalidasi/clamp. |
| Pool injection | Route staff memakai `resolvePool()` agar konsisten dan dapat diuji tanpa DB global. |

### 4.2 Frontend upload queue

| Perubahan | Perilaku baru |
|---|---|
| Timeout upload | `AbortController` membatalkan `PUT` setelah 60 detik (configurable), lalu retry backoff. |
| Jitter awal | Upload pertama ditunda acak 0–3 detik untuk memecah burst 1.200 siswa. |
| `already_uploaded` | PUT dilewati, konfirmasi idempoten dijalankan, antrean tetap terkuras. |

### 4.3 File yang diubah dan alasannya

| File | Alasan |
|---|---|
| `arena/apps/api/src/services/recording-policy.ts` | Menambah clamp env + `getRecordingRuntimeLimits()` agar konfigurasi salah tidak memicu biaya/loop. |
| `arena/apps/api/src/routes/recording.ts` | Cap ukuran, proteksi overwrite, scope staff, batas configurable, pool injection. |
| `arena/apps/web/src/lib/upload-queue.ts` | Timeout, jitter awal, dukungan `already_uploaded`. |
| `arena/.env.example` | Mendokumentasikan dua batas baru dan bucket existing `cbt` (hanya contoh, bukan env production). |
| `arena/apps/api/tests/recording-security.test.mjs` | Test clamp, oversize, overwrite, scope list & playback. |
| `arena/apps/web/tests/recording-preflight.test.mjs` | Test timeout upload dan jalur `already_uploaded`. |

Tidak ada perubahan pada auth, waiting room, pembuatan attempt, autosave, timer, submit, finalization, hasil, worker count, pool DB, Nginx, atau skema.

---

## 5. Hasil test dan build

Dijalankan lokal:

| Perintah | Hasil |
|---|---|
| `npm run build -w @arena/api` | lulus |
| `./node_modules/.bin/tsc -b apps/web` | lulus tanpa error |
| `npm run build -w @arena/web` | lulus (warning chunk >500 kB yang sudah ada) |
| `node --test apps/api/tests/recording-security.test.mjs` | 18 lulus, 0 gagal |
| `node --test apps/web/tests/recording-preflight.test.mjs apps/web/tests/security-events.test.mjs apps/web/tests/away-episode.test.mjs apps/web/tests/face-report.test.mjs` | 24 lulus, 0 gagal |

**Tidak diuji (jangan diklaim lulus):**

- Rekaman nyata di Android Chrome/Firefox, iOS/iPadOS Safari, desktop.
- Upload nyata ke bucket `cbt` (CORS, izin PUT, presigned URL).
- HeadBucket/readiness terhadap akun Linode production.
- Uji 1.200 siswa bersamaan (load test production dilarang).
- Cleanup retensi nyata dan legal hold.
- Playability setiap segmen WebM/MP4.
- Perilaku saat kamera dicabut, tab disembunyikan, atau jaringan putus di perangkat nyata.

---

## 6. Temuan kompatibilitas mobile

- Preflight sudah memeriksa secure context, `getUserMedia`, track live, `MediaRecorder`, MIME, IndexedDB, dan probe rekaman singkat.
- iOS Safari dapat memakai MP4/H.264 dan membatasi fullscreen; backgrounding dapat menghentikan recorder. IndexedDB menyimpan segmen yang sudah selesai, tetapi chunk aktif bisa hilang saat OS membunuh tab.
- Android Chrome umumnya mendukung WebM/VP8; Firefox Android berbeda dukungan codec.
- Timeout upload baru memakai `AbortController` (didukung browser modern) dan tidak menambah dependency.
- Resolusi rekaman mengikuti stream kamera 640×480; target 360p belum diterapkan. Mengubah constraint kamera berisiko menurunkan akurasi face detection, jadi **tidak diubah** malam ini.
- Tidak ada klaim bahwa semua browser berperilaku identik.

---

## 7. Temuan Object Storage

- Kode memakai env `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, kredensial backend-only. Tidak ada secret di frontend.
- Object key: `recordings/{examId}/{attemptId}/{sessionId}/segment-{seq}.{ext}`; tanpa PII.
- Presigned URL upload/playback berumur pendek (default 300 detik).
- Readiness memakai `HeadBucket` single-flight dengan cache 30 detik (healthy) / 10 detik (unhealthy), aman untuk 1.200 siswa.
- Konfirmasi memakai `HeadObject` dan sekarang menolak objek di atas 8 MiB.
- Bucket/akun baru tidak dibuat. Tidak ada perubahan lifecycle atau billing.
- **Belum diverifikasi:** bucket `cbt` ada, CORS `PUT` untuk origin production, izin kredensial, kuota, dan aturan lifecycle.

---

## 8. Estimasi konsumsi storage dan biaya

Ringkasan (detail di `docs/production/recording-cost-estimation.md`):

| Skenario | Total satu sesi |
|---|---:|
| 1 klip/siswa @500 kbps | 2,25 GB |
| 5 klip/siswa @500 kbps | 11,25 GB |
| 10 klip/siswa @500 kbps | 22,5 GB |
| Continuous 120 menit @500 kbps | **540 GB** |

Retensi 7 hari, 10 klip @500 kbps: ±157,5 GB (masih di bawah asumsi kuota 250 GB).
Continuous 120 menit setiap hari selama 7 hari: ±3,78 TB → potensi kelebihan storage ±USD 70/bulan dengan asumsi USD 0,02/GB.

Biaya tambahan yang diimplementasikan: **USD 0**. Tidak ada dependency, server, atau layanan baru.

---

## 9. Risiko yang tersisa

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Recording masih continuous | Biaya storage/bandwidth besar jika diaktifkan | Biarkan nonaktif sampai event-based selesai & diuji |
| Segmen belum tentu playable mandiri | Evidence tidak bisa diputar | Uji staging + desain stop/restart MediaRecorder |
| Scope staff baru | Guru tanpa penugasan kehilangan akses playback | Verifikasi data `teacher_exam_assignments` sebelum deploy; rollback mudah |
| Cap 8 MiB | Klip sah yang bitrate-nya jauh di atas target bisa ditolak | Bitrate recorder 500 kbps; 8 MiB cukup untuk 60 detik; pantau `FAILED` |
| Frontend/API harus sinkron | Frontend lama + API baru bisa menandai `already_uploaded` sebagai gagal | Deploy web dan API bersama |
| Orphan object `PENDING` | Storage bocor halus | Tambahkan lifecycle rule / cleanup khusus setelah ujian, dengan approval |
| Env production tidak diketahui | Tidak bisa memastikan recording aktif/tidak | Cek `/etc/arena/arena-production.env` (tanpa mencetak secret) sebelum ujian |

---

## 10. Rekomendasi deployment

1. **Production freeze untuk besok.** Jangan deploy perubahan ini sebelum ujian selesai.
2. Jika recording belum divalidasi staging, pastikan `RECORDING_ENABLED=false` dan kebijakan `RECORDING_REQUIRED` konsisten (jangan sampai wajib rekaman tetapi recorder nonaktif, karena admission akan menolak siswa).
3. Andalkan face presence + security events untuk pengawasan besok; keduanya tidak mengunggah video.
4. Deploy perubahan ini hanya di maintenance window setelah ujian, setelah uji staging: preflight, upload klip kecil, playback oleh guru yang ditugaskan, penolakan guru yang tidak ditugaskan, dan `CLEANUP_DRY_RUN=true`.
5. Implementasi **event-based recording** (trigger wajah hilang >5 detik, multiple faces, kamera putus, tab hidden, fullscreen keluar, konflik sesi) adalah pekerjaan terpisah yang membutuhkan uji perangkat dan persetujuan owner. Jangan mengaktifkan continuous recording untuk 1.200 siswa.

---

## 11. Instruksi deployment (disiapkan, BELUM dijalankan)

Prasyarat: tidak ada attempt `IN_PROGRESS`, backup DB, migrasi `021`–`025` sudah ada, env tidak diubah.

```bash
# di VPS, sebagai user aplikasi
cd /srv/repos/portal-data-man
git status --short
git rev-parse HEAD            # simpan untuk rollback
git pull --ff-only origin main
cd arena
npm ci
npm run build
# reload PM2 lewat loader .env yang sudah ada di docs deployment
# jangan mengubah worker count / env
```

Verifikasi setelah reload:

```bash
curl -fsS http://127.0.0.1:3001/health/live
curl -fsS http://127.0.0.1:3001/health/ready
```

Uji fungsional (staging lebih dulu): policy endpoint, preflight kamera, upload satu segmen kecil, konfirmasi `UPLOADED`, playback oleh guru yang ditugaskan, dan `403` untuk guru yang tidak ditugaskan. Jangan menguji dengan attempt production aktif.

---

## 12. Rollback

Perubahan ini **tidak menambah migrasi/skema** dan tidak mengubah env production, jadi rollback hanya kode:

```bash
cd /srv/repos/portal-data-man
git checkout <commit-sebelumnya>   # simpan hash sebelum deploy
cd arena
npm ci
npm run build
# reload PM2 dengan prosedur yang sama
```

Data rekaman yang sudah ada tidak terpengaruh. Jika hanya scope staff yang bermasalah, revert file `arena/apps/api/src/routes/recording.ts` lalu build ulang; tetapi lakukan sebagai satu rilis agar frontend/API tetap sinkron.

---

## 13. Klasifikasi akhir

### Implemented and tested

- Clamp konfigurasi rekaman (`recording-policy.ts`).
- Cap ukuran segmen + hapus objek oversized (`recording.ts`).
- Proteksi overwrite segmen `UPLOADED` (`recording.ts` + `upload-queue.ts`).
- Scope akses staff untuk list & playback (`recording.ts`).
- Timeout upload + jitter awal (`upload-queue.ts`).
- Unit test untuk semua di atas; API build, web typecheck, web build lulus.

### Implemented but not tested

- Perilaku nyata di browser/perangkat dan bucket `cbt` (butuh staging + kredensial, tidak tersedia di sini).
- Interaksi scope staff dengan data penugasan production.
- Efek jitter/timeout pada jaringan seluler lambat.

### Recommended for later

- Rekaman event-based dengan cooldown, dedupe, dan batas klip per attempt.
- Recorder stop/restart per segmen agar setiap klip valid dan playable.
- Cleanup objek `PENDING`/`FAILED` yang orphan (dengan dry-run dan approval).
- Penyesuaian resolusi 640×360 setelah face detection diuji ulang.
- Uji staging 1.200 siswa dan uji perangkat Android/iOS.
- Lifecycle rule bucket untuk membatasi objek tak terkonfirmasi.

### Requires owner approval

- Menyalakan `RECORDING_ENABLED=true` di production.
- Mengubah `RECORDING_REQUIRED`, retensi, bitrate, atau ukuran batas di production.
- Deploy/rebuild/reload PM2 atau perubahan Nginx/Cloudflare.
- Perubahan lifecycle/billing Object Storage.
- Implementasi event-based recording dan uji beban production.

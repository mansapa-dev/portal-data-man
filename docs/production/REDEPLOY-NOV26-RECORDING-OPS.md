# Redeploy Arena — Recording, Security, Monitoring, Export Guru (Nov 26 2026)

> **Status: DOKUMEN PERSIAPAN. BELUM DIEKSEKUSI.**  
> Production sedang freeze menjelang ujian. Jangan deploy/restart/migrasi/load test sebelum owner memberi persetujuan dan tidak ada ujian/attempt aktif.

Tanggal dokumen: 2026-11-26  
Repo: `/home/kurogane/Documents/portal-data-man`  
HEAD saat dokumen dibuat: `7cdbfef feat(arena): unduh rekap excel per mapel untuk guru`

## 1. Cakupan rilis

Perubahan yang sudah ada di branch `main` lokal (commit terbaru lebih dulu):

| Commit | Ringkasan | Area |
|---|---|---|
| `7cdbfef` | Rekap Excel per mapel untuk guru, tanpa cek pengampu; fix validasi `cursor=0` | `apps/api/src/routes/staff.ts`, `apps/web/src/StaffOperations.tsx`, test |
| `d5f01bd` | Segmen rekaman jadi standalone per segmen; playback presign pin MIME + inline | `apps/web/src/lib/recorder.ts`, `apps/api/src/routes/recording.ts`, `services/object-storage.ts` |
| `0d9b4a0` | Search Sesi Berlangsung/Tinjauan Keamanan; izinkan presign upload segmen setelah submit (`finished:true`) | `StaffOperations.tsx`, `StaffSecurityReview.tsx`, `routes/recording.ts` |
| `072088f` | Dedup violation client/server; face detection lebih cepat; MULTIPLE_FACES sekali per episode | `StudentExam.tsx`, `scoring.ts`, `face-presence.ts`, `security-events.ts` |
| `9a2c30f` | Hardening recording: cap ukuran segmen 8 MiB, proteksi overwrite UPLOADED, scope staff exam, timeout/jitter upload, clamp env | `routes/recording.ts`, `upload-queue.ts`, `recording-policy.ts`, docs |

Perubahan lokal belum commit saat dokumen ini dibuat:

| File | Ringkasan | Risiko deploy |
|---|---|---|
| `arena/scripts/apply-recording-lifecycle.mjs` | Script opsional untuk pasang S3 lifecycle rule `recordings/` expire 1 hari | Tidak dipakai runtime; aman ikut repo. Butuh owner run dengan env S3. |

**Tidak ada migrasi DB baru** dalam rilis ini. Jangan jalankan migrasi lama secara membabi buta; cek dulu status migrasi 001–025 sesuai prosedur normal.

## 2. Dampak operasional

- **Tidak ada perubahan schema**. Rollback kode saja cukup.
- **Frontend + API harus sinkron** untuk fix `already_uploaded`, recorder standalone, presign-after-submit, search, dan export guru.
- **Segmen lama yang sudah terupload sebelum `d5f01bd`** bisa tetap tidak playable karena chunk lama bukan file WebM standalone. Fix ini hanya berlaku untuk rekaman setelah deploy.
- **Object Storage lifecycle 1 hari** adalah perubahan konfigurasi bucket, bukan deploy kode. Bisa menghapus object rekaman lama >1 hari pada siklus midnight berikutnya.
- **`recording-cleanup-worker.ts` belum terjadwal** di PM2; lifecycle mengurangi biaya storage, tapi metadata DB segment bisa tetap `UPLOADED` sampai worker dijalankan/dijadwalkan.
- **Production freeze**: semua langkah di bawah hanya untuk jendela maintenance yang disetujui owner.

## 3. Pre-deploy checklist

Lakukan saat **tidak ada ujian aktif** dan tidak ada attempt `IN_PROGRESS` yang penting.

```bash
cd /srv/repos/portal-data-man
git status --short
git rev-parse HEAD
pm2 status
```

Backup (sesuaikan user/db/path):

```bash
export ARENA_PREVIOUS_COMMIT="$(git rev-parse HEAD)"
export ARENA_BACKUP_DIR="$HOME/arena-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ARENA_BACKUP_DIR" && chmod 700 "$ARENA_BACKUP_DIR"
printf '%s\n' "$ARENA_PREVIOUS_COMMIT" > "$ARENA_BACKUP_DIR/previous-commit.txt"

export ARENA_DB='arena'
mysql -u arena_migrator -p "$ARENA_DB" \
  -e "SELECT COUNT(*) active_attempts FROM exam_attempts WHERE status='IN_PROGRESS';"
mysqldump -u arena_migrator -p --single-transaction --routines --triggers \
  "$ARENA_DB" > "$ARENA_BACKUP_DIR/database.sql"
test -s "$ARENA_BACKUP_DIR/database.sql" && chmod 600 "$ARENA_BACKUP_DIR/database.sql"

cp -a arena/apps/web/dist "$ARENA_BACKUP_DIR/web-dist"
```

Jangan cetak/commit isi `.env`, dump DB, atau kredensial.

## 4. Deploy kode (setelah owner approve)

```bash
cd /srv/repos/portal-data-man
git pull --ff-only origin main
git log --oneline -5

cd arena
node --version   # Node 22+
npm ci
npm run build
```

Pastikan artifact ada:

```bash
ls apps/api/dist/server.js apps/api/dist/finalization-worker.js \
   apps/api/dist/waiting-worker.js apps/web/dist/index.html
```

Simpan aset hashed lama agar browser yang masih membuka halaman lama tidak 404:

```bash
cp -an "$ARENA_BACKUP_DIR/web-dist/assets/." apps/web/dist/assets/
```

## 5. Reload PM2

Gunakan prosedur env yang sudah dipakai production (jangan hardcode secret). Pola existing:

```bash
cd /srv/repos/portal-data-man/arena
node --env-file=.env --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process';
const result = spawnSync(
  'pm2',
  ['startOrReload', 'infra/ecosystem.config.cjs', '--update-env'],
  { env: { ...process.env, ARENA_DIR: process.cwd() }, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
NODE

pm2 status
pm2 logs arena-api-1 --lines 50 --nostream
pm2 logs arena-finalization --lines 50 --nostream
pm2 logs arena-waiting --lines 50 --nostream
```

Setelah semua verifikasi lulus: `pm2 save`.

## 6. Verifikasi pasca deploy

### Health

```bash
curl -fsS http://127.0.0.1:3001/health/live
curl -fsS http://127.0.0.1:3001/health/ready
curl -fsS http://127.0.0.1:3002/health/live
curl -fsS http://127.0.0.1:3003/health/live
```

### Fungsional (staging dulu, lalu production smoke saat aman)

- Login admin/guru/siswa normal.
- Sesi Berlangsung: search by nama/nis/kelas/ruang/status bekerja.
- Tinjauan Keamanan: search bekerja.
- Guru: tab Hasil Ujian menampilkan panel "Rekap Excel Per Mapel", daftar mapel terisi, download `.xlsx` berhasil.
- Recording (jika enabled di staging): preflight kamera, segmen kecil terupload, confirm UPLOADED, playback oleh staff yang berwenang.
- Segmen yang sudah `UPLOADED` tidak menerima presigned PUT baru (`already_uploaded`).
- Playback segmen baru setelah deploy bisa diputar; segmen lama sebelum fix mungkin tidak playable (expected).

### Observasi cepat

```bash
pm2 status
pm2 logs arena-api-1 --lines 100 --nostream
pm2 logs arena-api-2 --lines 100 --nostream
pm2 logs arena-api-3 --lines 100 --nostream
```

Perhatikan error 5xx, `recording`, `presign`, `submit`, `finalization`, `export`.

## 7. Opsional: Lifecycle Object Storage 1 hari (owner approval)

Ini **bukan deploy kode**. Tujuan: hapus object `recordings/` setelah 1 hari untuk menekan biaya bucket `cbt`.

Prasyarat: env S3 production tersedia di shell; bucket target benar `cbt`; owner paham dampaknya.

Dry-run:

```bash
cd /srv/repos/portal-data-man/arena
set -a; source /etc/arena/arena-production.env; set +a
node scripts/apply-recording-lifecycle.mjs --dry-run --days 1
```

Apply:

```bash
node scripts/apply-recording-lifecycle.mjs --days 1
```

Catatan:

- Linode lifecycle berjalan sekitar midnight setelah umur tercapai; 1 hari biasanya ~24–48 jam.
- Object lama di `recordings/` yang sudah lewat umur akan ikut terhapus pada siklus berikutnya.
- Hanya prefix `recordings/`; jangan ubah ke prefix luas.
- Lifecycle tidak mengubah MySQL. `exam_recording_segments.upload_status` bisa tetap `UPLOADED` sampai cleanup worker menandai `MISSING`.
- Pertimbangkan setelah ujian: set `RECORDING_RETENTION_DAYS=1` untuk session baru dan jadwalkan `recording-cleanup-worker.ts`/PM2 cron agar DB sinkron. Keduanya butuh persetujuan dan jendela maintenance.

## 8. Opsional: sinkronisasi DB cleanup worker

Status saat ini: `arena/apps/api/src/recording-cleanup-worker.ts` ada, tapi tidak terdaftar di `arena/infra/ecosystem.config.cjs`.

Jika owner ingin DB sinkron otomatis setelah object expired:

- Tambahkan jadwal PM2/cron yang menjalankan `node apps/api/dist/recording-cleanup-worker.js` dengan env production.
- Pastikan `RECORDING_RETENTION_DAYS` sesuai kebijakan (1 hari jika lifecycle 1 hari).
- Pertimbangkan one-time SQL untuk memperpendek `retain_until` lama; **butuh backup dan persetujuan owner**.
- Jangan jalankan worker bersamaan dengan perubahan schema/data besar tanpa review.

Ini belum diimplementasikan di PM2 ecosystem pada dokumen ini.

## 9. Rollback

Karena tidak ada migrasi baru, rollback cukup kode:

```bash
cd /srv/repos/portal-data-man
git checkout "$ARENA_PREVIOUS_COMMIT"   # atau commit yang disimpan di backup
cd arena
npm ci
npm run build
# reload PM2 dengan prosedur yang sama seperti section 5
```

Verifikasi `/health/live` dan smoke login/admin/guru/siswa.

Jika masalah hanya pada scope akses recording staff atau export guru, rollback dapat diisolasi ke commit terkait, tetapi lakukan sebagai rilis terkontrol dan pastikan frontend/API tetap kompatibel.

## 10. Yang tidak boleh diklaim selesai

- Belum ada uji staging perangkat nyata untuk recorder standalone baru (Android Chrome/Firefox, iOS Safari).
- Belum ada verifikasi lifecycle Linode benar-benar aktif di bucket production (butuh kredensial + owner run).
- Belum ada penjadwalan otomatis `recording-cleanup-worker`.
- Segmen lama sebelum fix recorder mungkin tetap tidak playable.
- Tidak ada load test 1.200 siswa setelah perubahan ini.

## 11. Referensi

- [docs/production/recording-cost-estimation.md](./recording-cost-estimation.md)
- [docs/production/safe-optimization-before-exam.md](./safe-optimization-before-exam.md)
- [arena/docs/ops/recording-admission-architecture.md](../../arena/docs/ops/recording-admission-architecture.md)
- [arena/docs/deployment/production-redeploy.md](../../arena/docs/deployment/production-redeploy.md)
- [docs/production/PRODUCTION-COMMANDS.md](./PRODUCTION-COMMANDS.md)

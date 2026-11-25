# Arena CBT — Estimasi Biaya Rekaman Ujian

> Dokumen ini adalah estimasi, bukan tagihan. Harga Object Storage di bawah adalah **asumsi** yang harus diverifikasi di konsol Linode/Akamai sebelum dijadikan keputusan. Tidak ada API berbayar yang dipanggil untuk menyusun dokumen ini.

Tanggal: 26 November 2026
Konteks: ujian ±1.200 siswa, satu sesi, rekaman berbasis event (target), retensi 7 hari.

---

## 1. Asumsi yang dipakai

| Item | Nilai | Status |
|---|---|---|
| Jumlah siswa | 1.200 | diberikan owner |
| Bitrate video | 350 kbps dan 500 kbps | target owner |
| Durasi klip | 30 detik | target owner |
| Audio | nonaktif | target owner |
| Retensi default | 7 hari | target owner |
| VPS existing | ±USD 72/bulan | diberikan owner |
| Kredit trial | ±USD 100 | diberikan owner |
| Object Storage | USD 5/bulan untuk 250 GB storage + 1 TB transfer keluar | **asumsi**, verifikasi konsol |
| Kelebihan storage | USD 0,02/GB-bulan | **asumsi**, verifikasi konsol |
| Kelebihan transfer keluar | USD 0,005/GB | **asumsi**, verifikasi konsol |

Rumus: **ukuran byte = bitrate (bit/detik) × durasi (detik) ÷ 8**.
Satuan di dokumen ini memakai GB desimal (1 GB = 1.000.000.000 byte) agar konservatif terhadap billing penyedia.

---

## 2. Ukuran satu klip 30 detik

| Bitrate | Byte per klip | MB per klip |
|---|---:|---:|
| 350 kbps | 1.312.500 | 1,31 MB |
| 500 kbps | 1.875.000 | 1,88 MB |

---

## 3. Ukuran per siswa dan total satu sesi (1.200 siswa)

| Klip/siswa | 350 kbps / siswa | 500 kbps / siswa | Total 350 kbps | Total 500 kbps |
|---:|---:|---:|---:|---:|
| 1 | 1,31 MB | 1,88 MB | 1,58 GB | 2,25 GB |
| 3 | 3,94 MB | 5,63 MB | 4,73 GB | 6,75 GB |
| 5 | 6,56 MB | 9,38 MB | 7,88 GB | 11,25 GB |
| 10 | 13,13 MB | 18,75 MB | 15,75 GB | 22,50 GB |

Total ini sama dengan **volume upload** satu sesi (browser → Object Storage). Upload masuk biasanya bukan komponen transfer keluar yang ditagih, tetapi tetap memakai bandwidth VPS/ISP siswa.

---

## 4. Dampak retensi 7 hari

Jika ada ujian setiap hari dan belum ada yang dihapus sampai hari ke-7, storage menumpuk 7× volume satu sesi.

| Klip/siswa | 7 hari @350 kbps | 7 hari @500 kbps |
|---:|---:|---:|
| 1 | 11,03 GB | 15,75 GB |
| 3 | 33,08 GB | 47,25 GB |
| 5 | 55,13 GB | 78,75 GB |
| 10 | 110,25 GB | 157,50 GB |

Dengan asumsi paket 250 GB, skenario event-based sampai 10 klip/siswa masih berada di dalam kuota storage paket USD 5/bulan (157,5 GB < 250 GB).

---

## 5. Dampak retensi 30 hari

| Klip/siswa | 30 hari @350 kbps | 30 hari @500 kbps |
|---:|---:|---:|
| 1 | 47,25 GB | 67,50 GB |
| 3 | 141,75 GB | 202,50 GB |
| 5 | 236,25 GB | 337,50 GB |
| 10 | 472,50 GB | 675,00 GB |

Pada 30 hari, skenario 10 klip @500 kbps melewati kuota 250 GB sekitar **425 GB**. Dengan asumsi USD 0,02/GB-bulan, kelebihan storage ±**USD 8,50/bulan** (total ±USD 13,50/bulan termasuk paket USD 5). Skenario 5 klip @500 kbps melewati kuota ±87,5 GB (≈USD 1,75/bulan).

Retensi 7 hari tetap direkomendasikan. Jangan menaikkan retensi tanpa persetujuan owner.

---

## 6. Egress / transfer keluar (playback)

Egress baru terjadi saat pengawas membuka/mengunduh klip. Dashboard tidak boleh mengunduh video secara otomatis.

| Skenario review | Klip ditonton | Egress @500 kbps |
|---|---:|---:|
| 5% siswa × 3 klip | 180 klip | ±0,34 GB |
| 20% siswa × 5 klip | 1.200 klip | ±2,25 GB |
| 100% siswa × 5 klip | 6.000 klip | ±11,25 GB |
| 100% siswa × 10 klip | 12.000 klip | ±22,50 GB |

Dengan asumsi kuota transfer 1 TB/bulan, egress review normal masih jauh di bawah kuota. Egress bisa membengkak jika klip ditonton berulang kali atau diunduh massal. **Jangan aktifkan auto-download/auto-play semua klip.**

Upload ≠ egress. Upload satu sesi (maksimal 22,5 GB pada skenario 10 klip) bukan transfer keluar yang ditagih, tetapi tetap membebani jaringan sekolah.

---

## 7. Peringatan: implementasi saat ini masih CONTINUOUS, bukan event-based

Kode saat ini (`apps/web/src/StudentExam.tsx`) menyalakan `MediaRecorder` selama ujian berlangsung dan memotong segmen setiap `RECORDING_SEGMENT_DURATION_SECONDS` (default 60 detik). Ini **bukan** rekaman berbasis event. Jika `RECORDING_ENABLED=true` di produksi, biayanya jauh lebih besar:

| Skenario continuous @500 kbps | Per siswa | 1.200 siswa |
|---|---:|---:|
| Ujian 60 menit | 225 MB | 270 GB |
| Ujian 120 menit | 450 MB | **540 GB** |
| Ujian 180 menit | 675 MB | **810 GB** |

Perbandingan: 5 klip event × 30 detik @500 kbps = **11,25 GB**, sekitar **48× lebih kecil** daripada continuous 120 menit (540 GB).

Jika ujian berlangsung setiap hari dan retensi 7 hari:

| Continuous 120 menit, 7 hari | ±3,78 TB |
|---|---|
| Kelebihan di atas 250 GB | ±3,53 TB |
| Estimasi kelebihan storage (asumsi USD 0,02/GB) | ±USD 70,6/bulan |
| Total storage (paket + kelebihan) | ±USD 75,6/bulan |

Angka itu belum termasuk egress jika pengawas menonton banyak klip. Artinya continuous recording berpotensi **menggandakan biaya infrastruktur bulanan** dan menghabiskan kredit trial.

**Rekomendasi:** untuk ujian besok, pastikan `RECORDING_ENABLED` sesuai keputusan owner. Jika recording belum divalidasi di staging, biarkan **nonaktif** (`RECORDING_ENABLED=false`) dan andalkan event keamanan + face presence. Jangan menyalakan continuous recording pada 1.200 siswa tanpa uji staging.

---

## 8. Ringkasan biaya bulanan

| Komponen | Estimasi |
|---|---:|
| VPS existing | ±USD 72/bulan |
| Object Storage paket dasar (asumsi) | ±USD 5/bulan |
| Event-based 7 hari (≤157,5 GB) | USD 0 tambahan |
| Event-based 30 hari 10 klip @500 kbps | ±USD 8,50 tambahan |
| Continuous 120 menit, 7 hari harian | ±USD 70,6 tambahan |
| Infrastruktur baru | USD 0 |
| Dependensi berbayar baru | USD 0 |

Sisa kredit trial setelah VPS + storage bulan pertama: ±**USD 23** (USD 100 − 72 − 5), sebelum pajak/overage. Verifikasi apakah kredit trial berlaku untuk VPS yang sudah berjalan.

---

## 9. Batas biaya yang sudah diterapkan di kode (lokal, belum deploy)

| Batas | Default | Env |
|---|---:|---|
| Ukuran maksimum satu segmen | 8 MiB | `RECORDING_MAX_SEGMENT_BYTES` |
| Nomor urut segmen maksimum per sesi | 300 | `RECORDING_MAX_SEGMENTS_PER_SESSION` |
| Bitrate | 500 kbps (clamp 200 kbps–1,5 Mbps) | `RECORDING_VIDEO_BITRATE` |
| Durasi segmen | 60 detik (clamp 10–300 detik) | `RECORDING_SEGMENT_DURATION_SECONDS` |
| Retensi | 7 hari (clamp 1–365 hari) | `RECORDING_RETENTION_DAYS` |

Batas ini mengurangi risiko tagihan tak terduga, tetapi **belum menggantikan** desain event-based.

---

## 10. Yang belum bisa diverifikasi dari sini

- Harga aktual akun Linode/Akamai dan apakah bucket `cbt` memakai paket 250 GB / 1 TB.
- Pemakaian storage dan transfer saat ini.
- Apakah `RECORDING_ENABLED=true` di `/etc/arena/arena-production.env` (tidak ada akses SSH).
- Kuota dan aturan lifecycle pada bucket `cbt`.
- Perilaku MediaRecorder nyata di 1.200 perangkat.

Jangan mengklaim angka di dokumen ini sebagai tagihan final. Cocokkan dengan konsol penyedia setelah ujian.

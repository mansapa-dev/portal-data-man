# Status pengukuran setelah perubahan

Belum ada hasil k6 yang sah. Pada mesin ini tidak tersedia Docker, k6, Node >=22, atau konfigurasi DB Arena lokal. Tidak ada request ke staging/production. Karena baseline juga belum dapat diukur, klaim peningkatan latency atau kesiapan 1.015 siswa **belum dibuat**.

## Round berikutnya (setelah commit `ee4306a3`)

- Mulai: gate antrean tingkat (Redis) dan warm-up cache sumber soal pindah **ke luar** transaksi MySQL. Transaksinya sendiri kini hanya berisi: baca attempt/ujian, INSERT attempt, bulk INSERT snapshot, commit. Siswa yang ditolak gate (HTTP 425) tidak lagi mengambil koneksi pool MySQL sama sekali; preflight sekarang menghitung `exam_open` (status, jendela waktu, target) dalam satu round-trip yang sama, non-locking.
- Selesai: pembersihan dead-code fallback pada hitung `option_count` di scoring (kolom teks opsi memang tidak diseleksi).
- Jawab: tidak ada perubahan semantik; tayangan batch/dedup `mutation_id` tetap.
- Perubahan belum diukur k6; angka tetap menunggu run lokal/staging sesuai [local-run.md](local-run.md).

Perubahan yang siap diukur:

- Mulai/load: pembacaan sumber soal dibagi melalui singleflight lokal dan cache Redis dengan TTL pendek; setiap attempt masih membuat snapshot 40 soal di MySQL.
- Jawab/simpan: client mengirim perubahan dalam batch 3–4 detik; server memvalidasi dan menyimpan hingga 40 jawaban dalam satu transaksi dengan dua bulk write.
- Selesai: client memastikan batch terakhir selesai sebelum submit dan mengulang submit idempotent bila ada gangguan sementara; scoring tetap sinkron di MySQL.
- Pool/log: konfigurasi awal 12 koneksi per proses, timeout koneksi TCP 10 detik, dan log `warn`; nilai akhir harus dipilih dari pengukuran staging.
- Diagnostik agregat `exam_start` dan `exam_batch` mencatat waktu total serta antre pool tanpa mencatat data siswa atau setiap request.

Unit test batch/cache dan build API lulus pada Node 18.8.0, tetapi integrasi Fastify HTTP, DB, Redis, client, dan k6 memerlukan Node >=22 serta layanan lokal. Jalankan panduan `local-run.md`, simpan hasil sebelum/sesudah dan periksa integritas hasil sebelum menyatakan bottleneck terselesaikan.

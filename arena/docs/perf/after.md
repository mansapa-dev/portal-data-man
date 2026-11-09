# Status pengukuran setelah perubahan

Belum ada hasil k6 yang sah. Pada mesin ini tidak tersedia Docker, k6, Node >=22, atau konfigurasi DB Arena lokal. Tidak ada request ke staging/production. Karena baseline juga belum dapat diukur, klaim peningkatan latency atau kesiapan 1.015 siswa **belum dibuat**.

Perubahan yang siap diukur:

- Mulai/load: pembacaan sumber soal dibagi melalui singleflight lokal dan cache Redis dengan TTL pendek; setiap attempt masih membuat snapshot 40 soal di MySQL.
- Jawab/simpan: client mengirim perubahan dalam batch 3–4 detik; server memvalidasi dan menyimpan hingga 40 jawaban dalam satu transaksi dengan dua bulk write.
- Selesai: client memastikan batch terakhir selesai sebelum submit dan mengulang submit idempotent bila ada gangguan sementara; scoring tetap sinkron di MySQL.
- Pool/log: konfigurasi awal 12 koneksi per proses, timeout koneksi TCP 10 detik, dan log `warn`; nilai akhir harus dipilih dari pengukuran staging.
- Diagnostik agregat `exam_start` dan `exam_batch` mencatat waktu total serta antre pool tanpa mencatat data siswa atau setiap request.

Unit test batch/cache dan build API lulus pada Node 18.8.0, tetapi integrasi Fastify HTTP, DB, Redis, client, dan k6 memerlukan Node >=22 serta layanan lokal. Jalankan panduan `local-run.md`, simpan hasil sebelum/sesudah dan periksa integritas hasil sebelum menyatakan bottleneck terselesaikan.

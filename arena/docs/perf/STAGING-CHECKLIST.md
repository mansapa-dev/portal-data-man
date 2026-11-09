# Checklist uji staging sebelum production

- Gunakan data dummy dan skema yang setara; siapkan Redis dan DB staging tanpa secret production di mesin uji lokal. Selesaikan seluruh migrasi non-destruktif yang diperlukan pada staging secara manual.
- Warmup paket tepat sebelum gelombang mulai, lalu jalankan k6 bertahap (100, 500, 1.015 VU), termasuk `MODE=simultaneous`, mode jitter, serta `STRESS=true`. Uji alur login terpisah dari alur ujian.
- Bandingkan endpoint mulai/soal, batch jawab, dan submit. Target awal p95: mulai/soal <1,5 detik, jawab <800 ms, selesai <2 detik, error <1%. Catat p99, throughput, 409, 429, dan timeout terpisah; error 0% adalah target validasi lokal.
- Periksa jumlah siswa yang benar-benar selesai terhadap `exam_results`, duplikat hasil, revisi jawaban, dan jawaban terakhir sebelum submit. Uji retry saat respons hilang, dua tab, submit ganda, habis waktu, dan admin mengubah soal.
- Pantau Grafana: CPU per core, event loop delay, iowait, load average, swap, RSS setiap proses, koneksi aktif/antre pool DB, lock/deadlock MySQL, Redis memory/latency/eviction, dan network. Disk tetap dipantau, tetapi jangan diasumsikan sebagai penyebab.
- Go bila target latency dan error tercapai pada tiga pengulangan, tidak ada jawaban yang sudah diakui lalu hilang, tidak ada duplikat hasil, jumlah hasil cocok, dan resource stabil tanpa antrean yang terus tumbuh. No-go jika ada pelanggaran integritas, kebocoran kunci, pool/Redis tidak pulih, atau latency melewati target secara berulang.
- Simpan hasil mentah k6 dan versi commit yang diuji. Terapkan konfigurasi infra manual hanya setelah checklist lulus; siapkan rollback dari `docs/ops/README.md`.

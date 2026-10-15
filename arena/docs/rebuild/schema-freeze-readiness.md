# Arena CBT — Phase 2.2 Schema Freeze Readiness Audit

**Status: NOT READY for schema freeze.** Dokumentasi dan analisis saja; ini bukan persetujuan schema, migration, implementasi, akses database produksi, deployment, atau klaim kapasitas 1.200 pengguna.

Dokumen yang direview: Business Rules Closure, Phase 2 Design Review Revision 2, dan ERD Revision 2. Saya juga memeriksa asumsi teknis di dokumen Phase 2 sebelumnya. Tidak ada koneksi ke database produksi/staging dan tidak ada file environment yang dibaca.

## Ringkasan

Rancangan punya arah integritas yang baik: snapshot soal per attempt, composite relationship untuk attempt/jawaban/hasil, receipt idempotensi, pemilihan hasil eksplisit, dan lifecycle yang dikendalikan server. Namun desain **belum siap dibekukan**.

Masih ada keputusan sekolah tentang eligibility, attempt tambahan, deadline dan penghentian, penilaian dan pemilihan hasil, permission, identitas siswa, serta retensi. Ada pula hal teknis yang perlu dibenahi: ERD mendeklarasikan USER_SESSIONS dua kali; beberapa relasi yang diklaim tidak diikat composite FK; riwayat nilai manual hanya menyimpan agregat; konten publik dan private grading berada pada row yang sama; dan test SAVE-05 masih menyebut JSON-null meski katalog sudah menetapkan teks kosong/opsi kosong.

Repository menunjukkan skrip demo memakai image mysql:8.4 dan README menyebut MySQL 8/MariaDB. Ini **bukan bukti versi server Arena yang ditargetkan atau dipakai**. Versi/engine/SQL mode server aktual belum diverifikasi. MySQL 8.4 mensyaratkan tipe kolom FK dan parent sesuai serta key parent terindeks; referensi non-unique dinyatakan deprecated. [MySQL 8.4 FK constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html). Dokumentasi MySQL juga menjelaskan SKIP LOCKED untuk claim antrean, namun tetap harus diuji pada target staging yang dipilih. [MySQL 8.4 locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).

## Matriks readiness

| Area | Status | Alasan |
|---|---|---|
| Fondasi yang telah disepakati: Fastify, strict TypeScript, React, Vite, MySQL family, modular monolith, DB baru, adapter Portal Data, NISN+PIN lokal, staff OIDC | READY | Keputusan proyek eksplisit; tidak menyelesaikan kebijakan yang masih terbuka. |
| Eligibility, roster, koreksi roster, riwayat enrollment | BLOCKED | Sekolah harus menyetujui cutoff dan proses koreksi; data sumber saat ini hanya membuktikan enrollment teramati. |
| Attempt, remedial, susulan, retake, authorization dan hasil resmi | BLOCKED | Kind, batas, pihak berwenang, parent, deadline, dan pemilihan hasil belum ditetapkan sekolah. |
| Deadline, pause/close, expiry, cancellation, termination | BLOCKED | Cutoff dan perlakuan jawaban/hasil belum disetujui. |
| Jenis soal, rumus nilai, rounding, regrade dan publikasi | BLOCKED | Berpengaruh ke model nilai, API, UI, dan hasil resmi. |
| Role, admin identity, PIN/NISN, session dan retention | BLOCKED | Prosedur sekolah dan pemilik operasional belum tersedia. |
| Composite key, FK, nullability, tipe, index dan parity ERD-katalog | TECHNICAL REVIEW | Beberapa constraint perlu dilengkapi/dikoreksi; candidate-key matrix belum cukup presisi. |
| Kesamaan attempt_kind dan aturan authorization | TECHNICAL REVIEW | Composite FK membatasi kind/assignment/student, tetapi validity, policy, parent conditional, dan unused state masih service-only. |
| Pemisahan data soal publik/private | TECHNICAL REVIEW | Keamanan bergantung pada proyeksi API; schema tidak memisahkan akses. |
| Exact MySQL/MariaDB target dan perilaku DDL | STAGING REQUIRED | Hanya image demo yang diketahui, bukan server target aktual. |
| Build DDL, CHECK, generated unique, composite FK, transaction, locking | STAGING REQUIRED | Belum diuji pada target isolated; migration belum dibuat/dijalankan. |
| Query plan, budget resource, load test 1.200 | STAGING REQUIRED | Belum ada hasil ukur atau load test. |
| Snapshot immutable, prinsip idempotensi, larangan klaim kapasitas tanpa bukti | READY | Arah desain jelas; perlu implementasi dan pembuktian setelah persetujuan. |

**Kesimpulan:** schema freeze diblokir. Jangan membuat migration sebelum BLOCKED disetujui dan TECHNICAL REVIEW ditutup. Staging adalah gate tersendiri setelah rancangan final tersedia.

## Matriks semua keputusan

Status: BLOCKED = perlu keputusan sekolah; TECHNICAL REVIEW = perlu validasi/desain teknis; STAGING REQUIRED = harus dibuktikan pada target non-produksi; READY = cukup jelas untuk tidak memblokir freeze.

| Keputusan | Status | Tindakan |
|---|---|---|
| Fondasi stack dan autentikasi yang telah disepakati | READY | Pertahankan sesuai keputusan sebelumnya. |
| A1 cutoff eligibility dan active-account recheck | BLOCKED | Sekolah memilih snapshot saat publish, saat mulai, atau aturan lain; tentukan dampak akun yang dinonaktifkan setelah publish. |
| A2 koreksi roster dan enrollment historis | BLOCKED | Pilih cancel/reissue atau amendment ber-versi; putuskan apakah data enrollment teramati cukup untuk launch. |
| A3 data akademik hilang/duplikat | BLOCKED | Tetapkan quarantine, direct assignment, dan data steward pemutus konflik. |
| B1 jenis attempt dan parent attempt | BLOCKED | Sekolah menetapkan kind yang berbeda dan parent wajib per kind. |
| B2 pemberi izin, count, window, deadline, konsumsi kuota | BLOCKED | Tetapkan role, batas jumlah, masa berlaku, dan apakah attempt batal/expired mengonsumsi slot. |
| B3 hasil resmi dan tie-break | BLOCKED | Pilih primary/latest/highest/per-assignment beserta aturan tie-break. |
| C1 adjudikasi deadline dan grace/in-flight | BLOCKED | Pilih DB lock time, trusted ingress time, atau grace; putuskan request yang diterima sebelum cutoff tetapi menunggu lock. |
| C2 pause, close dan cancel | BLOCKED | Tentukan apakah attempt aktif terus, timer berhenti, atau attempt dihentikan. |
| C3 jawaban dari attempt expired/terminated/cancelled | BLOCKED | Tentukan apakah dinilai dan dapat menjadi hasil terpilih; bedakan timeout dan pelanggaran bila perlu. |
| D1 jenis soal dan rubric awal | BLOCKED | Setujui objective/short answer/essay dan workflow penilaian manual. |
| D2 formula, blank, partial/negative credit, cap, rounding | BLOCKED | Berikan aturan dan contoh batas sebelum kontrak skor dibekukan. |
| D3 regrade dan publikasi | BLOCKED | Tentukan reason, second approval, unpublish, notifikasi, dan pihak berwenang. |
| E1 permission guru/admin/pengawas | BLOCKED | Setujui siapa boleh lihat jawaban, force submit, terminate, memberi attempt, menilai, dan publish. |
| E2 admin lokal atau staff OIDC | BLOCKED | Pilih model identitas dan pemilik proses recovery/provisioning. |
| F1 penerbitan/reset/pengiriman PIN | BLOCKED | Tetapkan role dan cara pengiriman rahasia satu kali. |
| F2 koreksi/duplikasi NISN | BLOCKED | Tetapkan bukti koreksi, otorisasi rebind dan pencabutan session. |
| F3 throttling login | BLOCKED | Pemilik keamanan menetapkan fairness policy; angka dapat dituning di staging. |
| F4 completeness/reconciliation sync | BLOCKED | Portal Data owner mengonfirmasi makna status, kelengkapan dan deactivation; jangan deaktivasi berdasarkan scan parsial. |
| G1 lifetime dan jumlah device session | BLOCKED | Setujui idle/absolute maximum dan device policy sebelum auth API dibekukan. |
| G2 event pencabutan session | BLOCKED | Tentukan event mana yang revoke session sebelum auth diluncurkan. |
| H1 retensi/arsip/penghapusan | BLOCKED | Records/privacy owner menetapkan jadwal bagi jawaban, receipt, nilai, audit, sync, session, snapshot. |
| H2 versi/engine/SQL mode DB aktual | STAGING REQUIRED | Verifikasi read-only terhadap target isolated dan pin versinya. Produksi belum diperiksa. |
| H3 resource bersama dan SLO | STAGING REQUIRED | Ukur max connections, beban layanan lain, CPU/RAM dan budget worker/pool. |
| H4 profil dan kapasitas 1.200 | STAGING REQUIRED | Setujui workload, jalankan load test bertahap di staging dan laporkan hasil. Saat ini belum terbukti. |
| T1–T6 pilihan engineering | TECHNICAL REVIEW | Finalisasi locking/idempotency, sync, index, ID, decimal, migration mechanics, deployment tanpa menjadikannya kebijakan sekolah. |

Opsi, dampak dan pemilik persetujuan rinci tetap dicatat di [Business Rules Closure](./business-rules-closure.md).

## Temuan teknis berdasarkan risiko

### Critical

| ID | Temuan | Dampak | Rekomendasi |
|---|---|---|---|
| C-01 | Keputusan sekolah mengenai eligibility, attempt, deadline/terminal, grading/result selection, permission, identity dan retention belum selesai. | Migration dapat mengunci kebijakan yang tidak pernah disetujui serta mengubah makna histori. | Dapatkan persetujuan tertulis sebelum freeze. |
| C-02 | ERD mendeklarasikan USER_SESSIONS dua kali. | Diagram bisa gagal dirender atau membuat pembaca mengira ada dua tabel; tidak dapat dijadikan artifact freeze yang andal. | Hapus deklarasi ganda dan validasi hasil render pada perbaikan dokumen berikutnya. |
| C-03 | Dokumen menyatakan source_student_id_snapshot terikat ke siswa, tetapi FK hanya ke students(id); source/provider ID snapshot tidak dibuktikan sama dengan source identity siswa. | Nilai snapshot yang salah tetap lolos FK. | Putuskan apakah harus cocok; tambahkan candidate key/composite FK atau transaksi validasi publish dan test. |
| C-04 | Enrollment punya FK terpisah ke class dan academic year; classes.academic_year_id nullable, sehingga class dan year enrollment dapat berbeda. exam_assignment_classes juga tidak mengikat kelas ke periode assignment. | Roster dapat memuat kelas/periode yang tidak konsisten. | Definisikan semantik periode kelas; tambahkan composite constraints jika sumber mampu membuktikannya, atau validasi saat sync/publish. |
| C-05 | UK(academic_year_id,semester_type) mengasumsikan satu semester ODD/EVEN per tahun tanpa kontrak sumber yang membuktikan itu. | Record sah dapat gagal sync atau terpaksa digabung. | Verifikasi cardinality sumber; jangan pakai UK tersebut tanpa jaminan provider. |
| C-06 | exam_result_revisions menyimpan total nilai, bukan snapshot item nilai/rubric. exam_result_items hanya memiliki satu current row per soal dan dapat berubah saat regrade. | Nilai lama per soal dan dasar perhitungan mungkin tidak dapat direkonstruksi untuk keberatan. | Tambahkan item revision immutable atau simpan snapshot grading lengkap per result revision. |
| C-07 | Keberadaan receipt/result/job untuk setiap SUBMITTED dan status GRADED sebelum selected hanya dijaga service transaction. FK tidak menjamin keberadaan/status lintas-row ini. | Bug aplikasi/manual SQL dapat meninggalkan state parsial atau mengekspos hasil belum selesai. | Tambahkan transaksi wajib, reconciliation query/alert, dan test negatif; kaji trigger hanya bila perlu. |

### High

| ID | Temuan | Dampak | Rekomendasi |
|---|---|---|---|
| H-01 | Authorization kind cocok dengan extra attempt melalui FK; MAIN tanpa auth. Validity, revoke, policy allow flag, parent requirement, deadline derivation, max count dan unused state masih service-only. | Authorization valid secara FK masih bisa dipakai di luar waktu/policy atau berulang karena race. | Sekolah tutup semantik kind; transaksi lock assignment/student/authorization, validasi window/policy/deadline/parent/consumption dan uji double-use. |
| H-02 | Retry mutation lama setelah revision lebih baru belum punya response contract eksplisit. | Client bisa menyangka state lama masih current atau retry menimpa jawaban baru. | Retry mutation ID yang sama harus mengembalikan hasil receipt sebelumnya dan current revision terpisah; jangan apply ulang. Body/question berbeda harus conflict. |
| H-03 | FK last_mutation_id tidak membuktikan answers.revision sama dengan answer_write_receipts.result_revision. | Pointer receipt dan revision jawaban bisa tak sinkron tetapi tetap lolos FK. | Validasi equality dalam transaksi dan reconciliation; kaji composite key revision bila DB enforcement dibutuhkan. |
| H-04 | Prompt/options publik dan answer key/private grading config berada pada tabel/row yang sama. | Query/serializer generik dapat membocorkan kunci atau rubric. | Pisahkan tabel private bila layak, atau gunakan query allowlist sempit; buat test kebocoran untuk semua endpoint siswa. |
| H-05 | exam_questions mengacu question_version tetapi tidak membuktikan versi itu milik subject exam yang sama. | Soal lintas subject bisa masuk meski semua ID valid. | Tentukan apakah lintas subject boleh; jika tidak, composite key chain atau validasi publish yang wajib. |
| H-06 | SAVE-05 masih mengharapkan JSON-null, sedangkan katalog menyatakan teks kosong/opsi kosong; ERD juga tidak memuat seluruh nullability/type/index. | Implementasi dan test bisa menghasilkan semantik yang berbeda. | Sinkronkan test, katalog dan diagram; labeli ERD konseptual atau lengkapi spesifikasi normatif. |
| H-07 | Beberapa UK/candidate key terlihat redundan; contohnya jawaban punya unique attempt_question_id sekaligus kandidat lain. | Index tambahan menambah write/storage cost pada autosave. | Petakan setiap FK ke exact unique parent key, lalu buang index redundant setelah review DDL. |
| H-08 | UK enrollment (student,class,semester) mengasumsikan satu relasi per semester; sumber ID enrollment optional dan tidak ada version/effective interval key. | Banyak kelas/perpindahan yang sah dapat collision atau overwrite. | Konfirmasi cardinality Portal Data; modelkan identity/observation revision bila banyak record mungkin. |
| H-09 | Proses NISN collision/rebind belum first-class; snapshot NISN historis dapat berbeda dari login identity aktif. | Risiko salah mengikat login atau kehilangan akses; sulit audit. | Tetapkan prosedur manual, actor/reason, status konflik dan revoke session saat rebind. |
| H-10 | Private grading di snapshot tidak punya DB view/privilege boundary; keamanan sepenuhnya bergantung query aplikasi. | Satu endpoint generik dapat menyingkap kunci/rubric. | Tetapkan boundary query/DB account dan test allowlist untuk retrieval, refresh, error dan report siswa. |

### Medium

| ID | Temuan | Dampak | Rekomendasi |
|---|---|---|---|
| M-01 | Index assignment (status,starts_at,ends_at) belum dibuktikan cocok dengan predicate/range query. | Listing dapat scan lebih banyak dari perkiraan. | Jalankan EXPLAIN ANALYZE pada data staging representatif. |
| M-02 | Sync rule mengusulkan transaksi penuh untuk delta komplit, sementara batch disebut bounded. Full sync besar bisa menahan lock/log lama. | Kontensi layanan lain dan rollback mahal. | Ukur dataset; pertimbangkan staging tables dan promosi atomik singkat, tetap larang deactivation dari snapshot parsial. |
| M-03 | active_guard menahan satu sync RUNNING; tabel belum menetapkan heartbeat/lease. | Stuck run dapat menghambat sync atau watchdog salah abort proses lambat. | Tetapkan lease/heartbeat/owner dan recovery yang aman. |
| M-04 | JSON rich content dan LONGTEXT belum memiliki max payload/API body limits. | Amplifikasi memory, network dan DB storage. | Tetapkan limit dan uji payload maksimum sebelum endpoint dirilis. |
| M-05 | Selected result tidak menyimpan alasan/policy revision; bergantung pada policy assignment tetap immutable. | Override sulit dijelaskan bila ada perubahan konfigurasi/algoritma. | Bekukan/version policy dan audit actor/reason serta revision algoritma. |
| M-06 | Mermaid cardinality tidak dapat mengekspresikan seluruh nullable composite FK/CHECK; misalnya roster direct-only. | Diagram bisa dibaca sebagai jaminan FK yang sebenarnya tidak ada. | Tambahkan legend dan FK matrix normatif. |
| M-07 | ERD disebut lengkap namun tidak memuat panjang, nullability dan index semua kolom. | ERD saja tidak cukup untuk persetujuan schema. | Tegaskan katalog/FK matrix sebagai sumber normatif atau lengkapi diagram. |

### Low

| ID | Temuan | Dampak | Rekomendasi |
|---|---|---|---|
| L-01 | Encoding UUID, byte order dan collation belum dinyatakan. | Interoperabilitas/logging, bukan blocker utama integritas. | Dokumentasikan pada spesifikasi DDL/API. |
| L-02 | Actor FK bercampur RESTRICT/SET NULL; penghapusan akun dapat menghilangkan identitas actor yang bisa dibaca. | Audit masih ada tetapi atribusi dapat melemah. | Gunakan soft-disable dan tetapkan snapshot actor sesuai kebijakan privasi/retensi. |

## Audit fokus integritas

### Attempt kind dan authorization

Model enum sudah punya dasar yang baik: attempt MAIN tidak memiliki authorization; extra attempt terikat pada authorization dengan kind/assignment/student yang sama. Authorization juga terikat ke roster dan memiliki parent nullable. Namun aturan parent per kind, valid_from/valid_until, revoked_at, policy flag, deadline cap, max extra count dan one-use adalah validasi service. Count harus diserialisasi pada row yang stabil; SELECT COUNT biasa rentan race.

**Sebelum freeze:** sekolah menetapkan kind/parent/role/count; technical review mengunci urutan lock dan transaksi; tes concurrent consume, revoked/expired authorization, prohibited kind, serta deadline derivation.

### ANSWERS, receipts, last_mutation_id

FK mengikat answer ke snapshot attempt/question dan last mutation ke receipt attempt/question yang sama. Receipt dibuat dulu dalam transaksi yang sama, lalu answer menunjuknya. Tetapi FK tidak mengikat answer revision ke receipt result_revision.

Retry yang harus didukung: m1 committed revision 1, m2 committed revision 2, lalu retry m1 datang terlambat. Server mengembalikan receipt m1 dan current revision 2, tanpa mengembalikan nilai m1 menjadi current. Mutation ID sama dengan body/question berbeda harus conflict. SAVE-05 perlu diubah agar menyebut no row vs empty text/zero selected options, bukan JSON-null. Retensi receipt harus mengikuti keputusan retensi sekolah.

**Sebelum freeze:** tutup response contract, retention, revision conflict, dan uji loss sebelum/during commit.

### Assignment sampai hasil terpilih

Composite FK inti menghubungkan assignment/period, roster, attempt, question snapshot, answer, result dan selected result. Tetap ada gap C-03 sampai C-07: source ID snapshot tidak terikat ke siswa; kelas/year enrollment belum konsisten; target class belum terikat period assignment; question version belum terikat subject exam; item grading revision tidak immutable; eksistensi receipt/result/job dan state GRADED tetap service invariants.

**Sebelum freeze:** putuskan per invariant apakah DB constraint atau app transaction; buat FK/candidate-key matrix dengan urutan kolom exact; test cross-assignment, cross-student, cross-period, cross-subject.

### Autosave, submit, expiry, grading

- Autosave: attempt-first lock, revision, receipt, answer dan option replacement satu transaksi adalah arah baik. Retry lama dan receipt retention masih perlu aturan.
- Submit: receipt per attempt dan status/result/job transactional adalah arah baik. Tegaskan retry idempotency key berbeda tetap mengembalikan receipt lama; manifest mencakup semua snapshot, termasuk revision 0 untuk belum dijawab.
- Expiry: SKIP LOCKED sesuai pola claim queue di engine yang mendukungnya; request-time deadline check tetap diperlukan saat worker mati. Hasil submit-vs-expiry mengikuti keputusan cutoff sekolah.
- Grading: job/result unique per attempt dan lease membantu idempotensi. Item-level grading revision harus immutable jika regrade mengubah poin per soal.
- Lock order: completion grading attempt→result→job; pastikan tidak ada jalur job-lock lalu menunggu attempt, atau publish yang mengunci pointer/result dengan urutan terbalik.

**Sebelum freeze:** dokumentasikan transaction pseudocode per endpoint/worker dan uji contention, deadlock retry, lease expiry, unknown commit outcome pada target MySQL pilihan.

### Konten publik dan private grading

question_options.is_correct serta prompt_json/private_grading_json berada dalam tabel/row yang dapat dibaca bersama. Tidak ada batas schema yang mencegah SELECT mengembalikan private fields. Proposal Revision 2 mengandalkan allowlist query API.

**Rekomendasi:** pisahkan tabel private jika dapat memberi boundary jelas; jika tetap satu tabel, larang generic serialization dan gunakan proyeksi repository eksplisit. Uji seluruh route siswa, resume/refresh, error path dan report untuk kebocoran kunci/rubric.

### Sync akademik

Sumber yang diverifikasi memberi bukti tentang endpoint/repository dan image demo, bukan server target atau jaminan data lengkap. Enrollment yang tersedia merupakan data teramati, bukan histori efektif-dated. UK semester year/type dan enrollment student/class/semester perlu dikonfirmasi terhadap cardinality sumber. Pagination lengkap belum tentu memberi semantik authoritative deletion; deactivation hanya boleh setelah kontrak kelengkapan dan revision tervalidasi.

**Sebelum freeze:** Portal Data owner mengonfirmasi source IDs, cardinality, status inactive, completeness, revision consistency dan pagination; staging menguji duplicate, gap, required field kosong, revision drift, partial failure, replay dan rekonsiliasi.

## Kompatibilitas MySQL dan verifikasi lingkungan

Bukti repository yang diperiksa:
- arena/scripts/setup-local-demo.sh memakai image mysql:8.4 untuk demo lokal.
- arena/README.md menyebut MySQL 8/MariaDB.
- Driver aplikasi adalah mysql2.
- Versi/engine/SQL mode/collation/max_connections server target tidak diverifikasi. Tidak ada isi .env yang dibaca dan tidak ada koneksi DB dilakukan.

Jadi versi server Arena aktual **belum diketahui**. Jangan menyamakan image demo atau client lokal dengan server produksi. Pada target staging isolated, verifikasi version/engine/sql mode secara read-only, lalu uji DDL disposable database:
- setiap FK memakai candidate PRIMARY/UNIQUE yang sama urutan kolomnya, tipe/sign/width cocok, dan indeks child tersedia;
- CHECK enforced, generated guard dan unique NULL berperilaku sesuai;
- JSON, DATETIME(3), DECIMAL, transaksi, lock wait/deadlock dan FOR UPDATE SKIP LOCKED;
- clean install dan rollback diuji hanya pada DB disposable yang terisolasi.

Jangan jalankan pemeriksaan ini terhadap produksi. MySQL menyatakan FK child/parent perlu tipe kompatibel dan parent key terindeks; referenced non-unique key deprecated. [MySQL FK reference](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html). SKIP LOCKED menghasilkan view tidak konsisten dan cocok untuk claim queue, bukan pembacaan umum siswa. [MySQL locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).

## Audit index, nullability dan tipe

### Sudah cukup jelas
- ID internal diusulkan BIGINT UNSIGNED, dengan roles.id SMALLINT UNSIGNED; FK harus sama persis.
- Public ID 16 byte dan hash session/request 32 byte.
- Nilai memakai DECIMAL fixed-point.
- Status lifecycle non-null; terminal/published metadata nullable.
- Workload query utama sudah disebut: login, roster, resume, answer, expiry, grading, dashboard, result, audit.

### Perlu ditutup
1. Cocokkan semua tipe/sign FK, termasuk SMALLINT/BIGINT, generated fields, dan composite FKs.
2. Tetapkan UUID byte order, binary/text form, collation source ID/NISN, normalisasi NISN/username.
3. Petakan setiap FK ke exact parent candidate key; hapus index redundant setelah analisis DDL.
4. Jelaskan alasan unique global attempt_question_id pada answers dan index/candidate lain yang diperlukan.
5. Tetapkan max ukuran JSON/text dan request body.
6. Nyatakan nullable composite FK: direct-only roster semua kolom kelas/enrollment NULL; class roster semua konteks wajib NN dan harus cocok.
7. Tulis ON DELETE/ON UPDATE eksplisit per FK; jangan cascade hapus histori ujian.
8. Pastikan enum adalah DB ENUM, lookup table atau checked VARCHAR dan strategi perubahan nilainya.
9. Sinkronkan setiap tabel/kolom ERD dengan katalog.

## Tindakan berikutnya

| Urutan | Tindakan | Pemilik | Bukti selesai |
|---|---|---|---|
| 1 | Setujui keputusan sekolah A1–A3, B1–B3, C1–C3, D1–D3, E1–E2, F1–F2, G1–G2, H1. | Pemilik sekolah/akademik/asesmen/keamanan/records | Decision register ditandatangani, dengan tanggal dan cakupan. |
| 2 | Pastikan identity, enrollment cardinality/history, completeness dan reconciliation Portal Data. | Portal Data owner + data steward akademik | Kontrak tertulis atau fixture tersanitasi yang diterima. |
| 3 | Tutup C-02–C-07 dan H-01–H-10; terbitkan FK candidate matrix; selesaikan item score history. | Technical lead + DBA/security reviewer | Review desain baru; belum berarti perubahan aplikasi/migration. |
| 4 | Rekonsiliasi ERD/katalog/test matrix; hilangkan USER_SESSIONS ganda dan perbarui SAVE-05. | DB designer/technical writer | Diagram render valid dan tiap constraint dipetakan. |
| 5 | Verifikasi read-only versi/engine/SQL mode target isolated dan anggaran resource. | Infrastruktur/DB owner | Bukti staging; tanpa akses produksi. |
| 6 | Setelah approval, buat artifact DDL untuk review dan uji di disposable staging. | Technical lead/DBA | FK/CHECK/unique/locking/integrity tests lolos; rollback terdokumentasi. |
| 7 | Jalankan security/failure/concurrency dan load test bertahap di staging. | QA + technical/infra + exam owner | Hasil, SLO dan recovery disetujui. |

## Pernyataan kapasitas

Target 1.200 siswa belum terbukti. Audit ini tidak menjalankan load test produksi maupun staging. Klaim kapasitas memerlukan workload login/start/autosave/reconnect/submit yang realistis, uji staging berhasil tanpa kehilangan jawaban yang sudah diakui tersimpan, latency/error sesuai SLO, koneksi DB terbatas, serta headroom dan recovery terdokumentasi.


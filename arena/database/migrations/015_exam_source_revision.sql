-- Authoritative cache revision untuk sumber soal ujian (Tahap 1 optimasi kapasitas).
--
-- Desain: MySQL adalah satu-satunya sumber kebenaran invalidasi cache soal.
-- Setiap mutasi baris `questions` menaikkan `exams.source_revision` DALAM
-- TRANSAKSI YANG SAMA (trigger berjalan pada transaksi DML pemicunya, sehingga
-- mutasi yang rollback tidak pernah menaikkan revision). Redis hanya cache:
-- payload soal disimpan pada key `arena:exam:source:v2:{revision}:{examId}`,
-- dan pembaca selalu membaca revision terkini langsung dari MySQL, sehingga
-- Redis restart/unavailable/recovery tidak pernah menyajikan cache stale.
--
-- Catatan trigger UPDATE: `WHERE id IN (OLD.exam_id, NEW.exam_id)` menaikkan
-- revision kedua exam saat exam_id soal berpindah (cache kedua-duanya invalid),
-- dan tetap menaikkan tepat satu baris saat exam_id tidak berubah (IN dengan
-- nilai sama hanya mencocokkan satu baris).
--
-- Trigger TIDAK dijalankan oleh cascade FK (MySQL tidak menembakkan trigger
-- untuk ON DELETE CASCADE). Itu aman: exam yang dihapus tidak akan pernah
-- menjadi target claim lagi. Ujian duplikat/susulan menulis soal ke exam BARU
-- yang belum punya cache, jadi juga tidak berisiko stale.
--
-- Efek samping yang disengaja: bump revision mengubah `exams.updated_at`
-- (ON UPDATE CURRENT_TIMESTAMP) — semantik "exam terakhir dimodifikasi".
-- Tidak ada jalur hot-path yang membaca exams.updated_at.
--
-- Larangan MySQL 1442: statement yang memutasi `questions` TIDAK BOLEH
-- membaca/memutasi tabel `exams` dalam statement yang sama (mis. INSERT ...
-- SELECT ... FROM exams). Semua jalur aplikasi saat ini memakai literal
-- exam_id; jika nanti ada jalur baru, lakukan SELECT exams di statement
-- terpisah terlebih dahulu. Pelanggaran gagal LOUD (error 1442), bukan
-- corruption diam-diam.

SET @add_exam_source_revision = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='exams' AND column_name='source_revision'),
  'SELECT 1',
  'ALTER TABLE exams ADD COLUMN source_revision BIGINT UNSIGNED NOT NULL DEFAULT 0'
);
PREPARE arena_index_stmt FROM @add_exam_source_revision;
EXECUTE arena_index_stmt;
DEALLOCATE PREPARE arena_index_stmt;

DROP TRIGGER IF EXISTS trg_arena_question_src_ins;
CREATE TRIGGER trg_arena_question_src_ins AFTER INSERT ON questions
  FOR EACH ROW UPDATE exams SET source_revision=source_revision+1 WHERE id=NEW.exam_id;

DROP TRIGGER IF EXISTS trg_arena_question_src_upd;
CREATE TRIGGER trg_arena_question_src_upd AFTER UPDATE ON questions
  FOR EACH ROW UPDATE exams SET source_revision=source_revision+1 WHERE id IN (OLD.exam_id, NEW.exam_id);

DROP TRIGGER IF EXISTS trg_arena_question_src_del;
CREATE TRIGGER trg_arena_question_src_del AFTER DELETE ON questions
  FOR EACH ROW UPDATE exams SET source_revision=source_revision+1 WHERE id=OLD.exam_id;

-- Rollback manual untuk 015_exam_source_revision.sql.
-- Hanya dijalankan setelah versi aplikasi yang membaca source_revision
-- dilepas (kode lama mengabaikan kolom ini). Trigger dihapus agar mutasi
-- soal tidak error setelah kolom dibuang.
DROP TRIGGER IF EXISTS trg_arena_question_src_ins;
DROP TRIGGER IF EXISTS trg_arena_question_src_upd;
DROP TRIGGER IF EXISTS trg_arena_question_src_del;
ALTER TABLE exams DROP COLUMN source_revision;

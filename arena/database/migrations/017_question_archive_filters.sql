-- Arsip bank soal + indeks filter log pelanggaran.
--
-- `questions.status` mendapat nilai ARCHIVED. Arsip berbeda dari hapus:
-- soal tetap tersimpan untuk audit/riwayat, tetapi tidak lagi dipakai sebagai
-- sumber soal ujian (loader hanya membaca status='ACTIVE'). Deklarasi ulang
-- ENUM bersifat idempotent sehingga migrasi aman dijalankan berulang.
--
-- Indeks di bawah menargetkan query admin/staf yang paling sering dipanggil
-- pada saat ujian berlangsung: filter jenis pelanggaran + urutan waktu,
-- filter kelas/tingkat siswa, daftar hasil per waktu, dan daftar soal per
-- status. Semua penambahan indeks dijaga lewat information_schema agar tidak
-- gagal bila migrasi diulang.

ALTER TABLE questions
  MODIFY status ENUM('ACTIVE','DISABLED','ARCHIVED') NOT NULL DEFAULT 'ACTIVE';

SET @add_question_status_exam = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='questions' AND index_name='idx_arena_question_status_exam'),
  'SELECT 1',
  'ALTER TABLE questions ADD KEY idx_arena_question_status_exam (status,exam_id,id)'
);
PREPARE arena_017_stmt FROM @add_question_status_exam;
EXECUTE arena_017_stmt;
DEALLOCATE PREPARE arena_017_stmt;

SET @add_violation_type_time = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='violations' AND index_name='idx_arena_violation_type_time'),
  'SELECT 1',
  'ALTER TABLE violations ADD KEY idx_arena_violation_type_time (type,occurred_at,id)'
);
PREPARE arena_017_stmt FROM @add_violation_type_time;
EXECUTE arena_017_stmt;
DEALLOCATE PREPARE arena_017_stmt;

SET @add_student_class_grade = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='students' AND index_name='idx_arena_student_class_grade'),
  'SELECT 1',
  'ALTER TABLE students ADD KEY idx_arena_student_class_grade (class_snapshot,grade_snapshot)'
);
PREPARE arena_017_stmt FROM @add_student_class_grade;
EXECUTE arena_017_stmt;
DEALLOCATE PREPARE arena_017_stmt;

SET @add_result_time = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='exam_results' AND index_name='idx_arena_result_time'),
  'SELECT 1',
  'ALTER TABLE exam_results ADD KEY idx_arena_result_time (created_at,id)'
);
PREPARE arena_017_stmt FROM @add_result_time;
EXECUTE arena_017_stmt;
DEALLOCATE PREPARE arena_017_stmt;

SET @add_attempt_exam_updated = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='exam_attempts' AND index_name='idx_arena_attempt_exam_updated'),
  'SELECT 1',
  'ALTER TABLE exam_attempts ADD KEY idx_arena_attempt_exam_updated (exam_id,status,updated_at,id)'
);
PREPARE arena_017_stmt FROM @add_attempt_exam_updated;
EXECUTE arena_017_stmt;
DEALLOCATE PREPARE arena_017_stmt;

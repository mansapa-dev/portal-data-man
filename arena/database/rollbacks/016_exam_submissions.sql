-- Rollback manual untuk 016_exam_submissions.sql.
-- Hanya dijalankan setelah versi aplikasi yang membaca/menulis tabel ini dan
-- kolom exam_attempts.submitted_at sudah dilepas. Submission yang masih
-- RECEIVED/PROCESSING saat rollback akan kehilangan jejak durabelnya; attempt
-- terkait tetap dipulihkan oleh scanner expired lama (status IN_PROGRESS
-- expired / TERMINATED AUTO_SUBMIT tanpa hasil). Tidak ada data ujian yang
-- dihapus oleh migrasi ini maupun rollback-nya.
DROP TABLE IF EXISTS exam_submissions;
ALTER TABLE exam_attempts DROP COLUMN submitted_at;

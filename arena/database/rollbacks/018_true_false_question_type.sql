-- Rollback jenis soal Benar/Salah. Jalankan hanya setelah memastikan tidak ada
-- baris questions dengan question_type='TRUE_FALSE'.
UPDATE questions SET question_type='MULTIPLE_CHOICE' WHERE question_type='TRUE_FALSE';
ALTER TABLE questions
  MODIFY question_type ENUM('MULTIPLE_CHOICE','MULTIPLE_RESPONSE','SHORT_ANSWER')
  NOT NULL DEFAULT 'MULTIPLE_CHOICE';

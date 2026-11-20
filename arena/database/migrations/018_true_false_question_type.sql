-- Jenis soal Benar/Salah.
-- Opsi tetap: A = Benar, B = Salah. Kunci jawaban disimpan sebagai 'A' atau 'B',
-- sehingga penilaian, ekspor, dan snapshot attempt_questions (VARCHAR) tidak
-- memerlukan perubahan struktur lain.
ALTER TABLE questions
  MODIFY question_type ENUM('MULTIPLE_CHOICE','MULTIPLE_RESPONSE','SHORT_ANSWER','TRUE_FALSE')
  NOT NULL DEFAULT 'MULTIPLE_CHOICE';

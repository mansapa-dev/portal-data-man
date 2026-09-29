ALTER TABLE questions
 ADD COLUMN IF NOT EXISTS question_type ENUM('MULTIPLE_CHOICE','MULTIPLE_RESPONSE','SHORT_ANSWER') NOT NULL DEFAULT 'MULTIPLE_CHOICE' AFTER exam_id;
ALTER TABLE questions
 MODIFY option_a TEXT NULL, MODIFY option_b TEXT NULL, MODIFY option_c TEXT NULL, MODIFY option_d TEXT NULL, MODIFY correct_answer TEXT NOT NULL;

ALTER TABLE attempt_questions
 ADD COLUMN IF NOT EXISTS question_type VARCHAR(30) NOT NULL DEFAULT 'MULTIPLE_CHOICE' AFTER question_id;
ALTER TABLE attempt_questions
 MODIFY option_a TEXT NULL, MODIFY option_b TEXT NULL, MODIFY option_c TEXT NULL, MODIFY option_d TEXT NULL, MODIFY correct_answer TEXT NOT NULL;

ALTER TABLE student_answers MODIFY answer TEXT NULL;

UPDATE attempt_questions aq
JOIN questions q ON q.id=aq.question_id
SET aq.question_type=q.question_type;

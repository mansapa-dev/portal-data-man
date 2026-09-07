CREATE TABLE IF NOT EXISTS attempt_questions (
 attempt_id BIGINT UNSIGNED NOT NULL,
 question_id BIGINT UNSIGNED NOT NULL,
 question_text TEXT NOT NULL,
 option_a TEXT NOT NULL, option_b TEXT NOT NULL, option_c TEXT NOT NULL, option_d TEXT NOT NULL, option_e TEXT NULL,
 correct_answer CHAR(1) NOT NULL,
 points DECIMAL(8,2) NOT NULL,
 PRIMARY KEY (attempt_id,question_id),
 CONSTRAINT fk_attempt_questions_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Legacy attempts can only be backfilled from the question content available now.
INSERT IGNORE INTO attempt_questions(attempt_id,question_id,question_text,option_a,option_b,option_c,option_d,option_e,correct_answer,points)
SELECT a.id,q.id,q.question_text,q.option_a,q.option_b,q.option_c,q.option_d,q.option_e,q.correct_answer,q.points
FROM exam_attempts a JOIN questions q ON q.exam_id=a.exam_id
WHERE JSON_CONTAINS(a.question_order,CAST(q.id AS CHAR));

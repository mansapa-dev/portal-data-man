CREATE TABLE IF NOT EXISTS answer_write_versions (
 attempt_id BIGINT UNSIGNED NOT NULL,
 question_id BIGINT UNSIGNED NOT NULL,
 revision BIGINT UNSIGNED NOT NULL,
 mutation_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY (attempt_id,question_id),
 CONSTRAINT fk_answer_version_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE,
 CONSTRAINT fk_answer_version_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

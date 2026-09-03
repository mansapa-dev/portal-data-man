CREATE TABLE IF NOT EXISTS exam_follow_up_meta (
 exam_id BIGINT UNSIGNED PRIMARY KEY,
 source_exam_id BIGINT UNSIGNED NOT NULL,
 type ENUM('SUSULAN','REMEDIAL') NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_follow_up_source (source_exam_id),
 CONSTRAINT fk_follow_up_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
 CONSTRAINT fk_follow_up_source FOREIGN KEY (source_exam_id) REFERENCES exams(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

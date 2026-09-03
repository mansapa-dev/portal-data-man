CREATE TABLE IF NOT EXISTS exam_retake_candidates (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 source_exam_id BIGINT UNSIGNED NOT NULL,
 student_id BIGINT UNSIGNED NOT NULL,
 status ENUM('PENDING','APPROVED','SCHEDULED') NOT NULL DEFAULT 'PENDING',
 approved_by BIGINT UNSIGNED NULL,
 approved_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_retake_candidate (source_exam_id,student_id),
 KEY idx_retake_candidate_status (status),
 CONSTRAINT fk_retake_candidate_exam FOREIGN KEY (source_exam_id) REFERENCES exams(id) ON DELETE CASCADE,
 CONSTRAINT fk_retake_candidate_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
 CONSTRAINT fk_retake_candidate_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

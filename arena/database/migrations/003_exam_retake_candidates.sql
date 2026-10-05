CREATE TABLE exam_retake_candidates (
  source_exam_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  status ENUM('PENDING','APPROVED','SCHEDULED') NOT NULL DEFAULT 'PENDING',
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (source_exam_id,student_id),
  KEY idx_arena_retake_status (status,updated_at),
  CONSTRAINT fk_arena_retake_exam FOREIGN KEY (source_exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_arena_retake_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT fk_arena_retake_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO cbt_settings(key_name,value)
VALUES ('remedial_score_cap_X','75'),('remedial_score_cap_XI','75'),('remedial_score_cap_XII','75')
ON DUPLICATE KEY UPDATE key_name=VALUES(key_name);

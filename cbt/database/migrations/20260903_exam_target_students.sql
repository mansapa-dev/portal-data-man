CREATE TABLE IF NOT EXISTS exam_target_students (
 exam_id BIGINT UNSIGNED NOT NULL,
 student_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (exam_id,student_id),
 KEY idx_exam_target_students_student (student_id),
 CONSTRAINT fk_exam_target_students_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
 CONSTRAINT fk_exam_target_students_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

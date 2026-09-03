SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS students (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 portal_student_id VARCHAR(64) NOT NULL,
 portal_class_id VARCHAR(64) NULL,
 nisn VARCHAR(20) NOT NULL,
 name_snapshot VARCHAR(191) NOT NULL,
 class_snapshot VARCHAR(100) NULL,
 grade_snapshot VARCHAR(10) NULL,
 academic_year_snapshot VARCHAR(30) NULL,
 pin_hash VARCHAR(255) NULL,
 pin_encrypted TEXT NULL,
 cbt_status ENUM('ACTIVE','INACTIVE','BLOCKED') NOT NULL DEFAULT 'ACTIVE',
 is_active TINYINT(1) NOT NULL DEFAULT 1,
 last_synced_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_students_portal (portal_student_id),
 UNIQUE KEY uq_students_nisn (nisn),
 KEY idx_students_class_active (class_snapshot,is_active),
 KEY idx_students_grade_active (grade_snapshot,is_active),
 KEY idx_students_portal_class (portal_class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teachers (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 portal_teacher_id VARCHAR(64) NOT NULL,
 nip VARCHAR(50) NULL,
 nuptk VARCHAR(50) NULL,
 name_snapshot VARCHAR(191) NOT NULL,
 status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
 last_synced_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_teachers_portal (portal_teacher_id),
 UNIQUE KEY uq_teachers_nip (nip),
 UNIQUE KEY uq_teachers_nuptk (nuptk),
 KEY idx_teachers_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 teacher_id BIGINT UNSIGNED NULL,
 username VARCHAR(100) NOT NULL,
 password_hash VARCHAR(255) NOT NULL,
 name VARCHAR(191) NOT NULL,
 role ENUM('ADMIN','TEACHER') NOT NULL,
 status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
 last_login_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_users_username (username),
 UNIQUE KEY uq_users_teacher (teacher_id),
 KEY idx_users_role_status (role,status),
 CONSTRAINT fk_users_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_classes (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 portal_class_id VARCHAR(64) NOT NULL,
 code VARCHAR(50) NOT NULL,
 name VARCHAR(191) NOT NULL,
 grade VARCHAR(10) NULL,
 academic_year VARCHAR(30) NULL,
 status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
 last_synced_at DATETIME(3) NULL,
 UNIQUE KEY uq_classes_portal (portal_class_id), KEY idx_classes_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_academic_years (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 portal_academic_year_id VARCHAR(64) NOT NULL,
 name VARCHAR(30) NOT NULL,
 is_active TINYINT(1) NOT NULL DEFAULT 0,
 last_synced_at DATETIME(3) NULL,
 UNIQUE KEY uq_academic_years_portal (portal_academic_year_id),
 UNIQUE KEY uq_academic_years_name (name), KEY idx_academic_years_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_semesters (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 portal_semester_id VARCHAR(64) NOT NULL,
 portal_academic_year_id VARCHAR(64) NOT NULL,
 type ENUM('ODD','EVEN') NOT NULL,
 academic_year VARCHAR(30) NOT NULL,
 is_active TINYINT(1) NOT NULL DEFAULT 0,
 last_synced_at DATETIME(3) NULL,
 UNIQUE KEY uq_semesters_portal (portal_semester_id),
 UNIQUE KEY uq_semesters_period (portal_academic_year_id,type), KEY idx_semesters_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subjects (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 public_id CHAR(26) NOT NULL,
 code VARCHAR(30) NOT NULL,
 name VARCHAR(100) NOT NULL,
 status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_subjects_public (public_id),
 UNIQUE KEY uq_subjects_code (code), KEY idx_subjects_status_name (status,name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exams (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 public_id CHAR(26) NOT NULL,
 name VARCHAR(191) NOT NULL,
 portal_academic_year_id VARCHAR(64) NULL,
 portal_semester_id VARCHAR(64) NULL,
 subject_id BIGINT UNSIGNED NULL,
 grade VARCHAR(10) NOT NULL,
 duration_minutes SMALLINT UNSIGNED NOT NULL,
 session_number TINYINT UNSIGNED NOT NULL DEFAULT 1,
 starts_at DATETIME(3) NOT NULL,
 ends_at DATETIME(3) NOT NULL,
 academic_year VARCHAR(30) NOT NULL,
 semester ENUM('ODD','EVEN') NOT NULL,
 status ENUM('DRAFT','ACTIVE','INACTIVE','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
 created_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_exams_public (public_id),
 KEY idx_exams_eligibility (status,grade,starts_at,ends_at),
 KEY idx_exams_portal_period (portal_academic_year_id,portal_semester_id),
 CONSTRAINT fk_exams_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
 CONSTRAINT fk_exams_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
 CHECK (duration_minutes > 0), CHECK (ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_target_classes (
 exam_id BIGINT UNSIGNED NOT NULL,
 portal_class_id VARCHAR(64) NOT NULL,
 PRIMARY KEY (exam_id,portal_class_id),
 CONSTRAINT fk_exam_targets_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_target_students (
 exam_id BIGINT UNSIGNED NOT NULL,
 student_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (exam_id,student_id),
 KEY idx_exam_target_students_student (student_id),
 CONSTRAINT fk_exam_target_students_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
 CONSTRAINT fk_exam_target_students_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_follow_up_meta (
 exam_id BIGINT UNSIGNED PRIMARY KEY,
 source_exam_id BIGINT UNSIGNED NOT NULL,
 type ENUM('SUSULAN','REMEDIAL') NOT NULL,
 room VARCHAR(100) NULL,
 notes TEXT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_follow_up_source (source_exam_id),
 CONSTRAINT fk_follow_up_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
 CONSTRAINT fk_follow_up_source FOREIGN KEY (source_exam_id) REFERENCES exams(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS questions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 public_id CHAR(26) NOT NULL,
 exam_id BIGINT UNSIGNED NOT NULL,
 question_text TEXT NOT NULL,
 option_a TEXT NOT NULL, option_b TEXT NOT NULL, option_c TEXT NOT NULL, option_d TEXT NOT NULL, option_e TEXT NULL,
 correct_answer ENUM('A','B','C','D','E') NOT NULL,
 points DECIMAL(8,2) NOT NULL DEFAULT 1,
 status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_questions_public (public_id), KEY idx_questions_exam_status (exam_id,status),
 CONSTRAINT fk_questions_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
 CHECK (points > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_attempts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 public_id CHAR(26) NOT NULL,
 student_id BIGINT UNSIGNED NOT NULL,
 exam_id BIGINT UNSIGNED NOT NULL,
 status ENUM('IN_PROGRESS','COMPLETED','TERMINATED','EXPIRED') NOT NULL,
 started_at DATETIME(3) NOT NULL,
 expires_at DATETIME(3) NOT NULL,
 completed_at DATETIME(3) NULL,
 random_seed VARCHAR(64) NOT NULL,
 question_order JSON NOT NULL,
 option_mapping JSON NOT NULL,
 nisn_snapshot VARCHAR(20) NOT NULL,
 name_snapshot VARCHAR(191) NOT NULL,
 class_snapshot VARCHAR(100) NULL,
 grade_snapshot VARCHAR(10) NULL,
 academic_year_snapshot VARCHAR(30) NULL,
 violation_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_attempts_public (public_id), UNIQUE KEY uq_attempt_student_exam (student_id,exam_id),
 KEY idx_attempt_exam_status (exam_id,status), KEY idx_attempt_expiry (status,expires_at),
 CONSTRAINT fk_attempt_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
 CONSTRAINT fk_attempt_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_answers (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 attempt_id BIGINT UNSIGNED NOT NULL,
 question_id BIGINT UNSIGNED NOT NULL,
 answer ENUM('A','B','C','D','E') NULL,
 is_flagged TINYINT(1) NOT NULL DEFAULT 0,
 answered_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_answer_attempt_question (attempt_id,question_id), KEY idx_answers_question (question_id),
 CONSTRAINT fk_answers_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE,
 CONSTRAINT fk_answers_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_results (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 attempt_id BIGINT UNSIGNED NOT NULL,
 question_count SMALLINT UNSIGNED NOT NULL,
 correct_count SMALLINT UNSIGNED NOT NULL,
 wrong_count SMALLINT UNSIGNED NOT NULL,
 blank_count SMALLINT UNSIGNED NOT NULL,
 earned_points DECIMAL(10,2) NOT NULL,
 maximum_points DECIMAL(10,2) NOT NULL,
 score DECIMAL(6,2) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_results_attempt (attempt_id), KEY idx_results_score (score),
 CONSTRAINT fk_results_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS violations (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 public_id CHAR(26) NOT NULL,
 attempt_id BIGINT UNSIGNED NOT NULL,
 event_key VARCHAR(100) NOT NULL,
 type ENUM('TAB_HIDDEN','WINDOW_BLUR','FULLSCREEN_EXIT','OTHER') NOT NULL,
 occurred_at DATETIME(3) NOT NULL,
 client_occurred_at DATETIME(3) NULL,
 ip_address VARCHAR(45) NULL,
 user_agent VARCHAR(500) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_violations_public (public_id), UNIQUE KEY uq_violation_event (attempt_id,event_key),
 KEY idx_violations_attempt_time (attempt_id,occurred_at),
 CONSTRAINT fk_violations_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_exam_assignments (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, teacher_id BIGINT UNSIGNED NOT NULL, exam_id BIGINT UNSIGNED NOT NULL,
 created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_teacher_exam (teacher_id,exam_id), KEY idx_assignment_exam (exam_id),
 CONSTRAINT fk_assignment_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE RESTRICT,
 CONSTRAINT fk_assignment_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
 CONSTRAINT fk_assignment_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_sync_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sync_type ENUM('STUDENTS','TEACHERS','CLASSES','ACADEMIC_YEARS','SEMESTERS','ALL') NOT NULL,
 started_at DATETIME(3) NOT NULL, finished_at DATETIME(3) NULL, status ENUM('RUNNING','SUCCESS','FAILED','PARTIAL') NOT NULL,
 total INT UNSIGNED NOT NULL DEFAULT 0, inserted_count INT UNSIGNED NOT NULL DEFAULT 0, updated_count INT UNSIGNED NOT NULL DEFAULT 0,
 unchanged_count INT UNSIGNED NOT NULL DEFAULT 0, failed_count INT UNSIGNED NOT NULL DEFAULT 0, error_summary TEXT NULL,
 initiated_by BIGINT UNSIGNED NULL, KEY idx_sync_type_time (sync_type,started_at),
 CONSTRAINT fk_sync_actor FOREIGN KEY (initiated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, actor_user_id BIGINT UNSIGNED NULL, actor_role VARCHAR(30) NULL,
 action VARCHAR(100) NOT NULL, entity_type VARCHAR(100) NULL, entity_id VARCHAR(64) NULL,
 before_data JSON NULL, after_data JSON NULL, ip_address VARCHAR(45) NULL, user_agent VARCHAR(500) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), KEY idx_audit_actor_time (actor_user_id,created_at),
 KEY idx_audit_entity (entity_type,entity_id), KEY idx_audit_action_time (action,created_at),
 CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limits (
 bucket_key CHAR(64) PRIMARY KEY, attempts SMALLINT UNSIGNED NOT NULL, window_started_at DATETIME(3) NOT NULL,
 blocked_until DATETIME(3) NULL, updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 KEY idx_rate_cleanup (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

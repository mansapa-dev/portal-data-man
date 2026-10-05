-- Arena owns its schema. Apply to a new database; never point Arena at the CBT database.
CREATE TABLE students (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  portal_student_id VARCHAR(64) NOT NULL,
  portal_class_id VARCHAR(64) NULL,
  nisn VARCHAR(20) NOT NULL,
  name_snapshot VARCHAR(191) NOT NULL,
  class_snapshot VARCHAR(100) NULL,
  grade_snapshot VARCHAR(10) NULL,
  academic_year_snapshot VARCHAR(30) NULL,
  pin_hash VARCHAR(255) NULL,
  cbt_status ENUM('ACTIVE','INACTIVE','BLOCKED') NOT NULL DEFAULT 'ACTIVE',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_synced_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_arena_student_portal (portal_student_id),
  UNIQUE KEY uq_arena_student_nisn (nisn),
  KEY idx_arena_student_grade_active (grade_snapshot,is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE exams (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  name VARCHAR(191) NOT NULL,
  grade VARCHAR(10) NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  session_number TINYINT UNSIGNED NOT NULL DEFAULT 1,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  academic_year VARCHAR(30) NOT NULL,
  semester ENUM('ODD','EVEN') NOT NULL,
  subject_name VARCHAR(100) NULL,
  status ENUM('DRAFT','ACTIVE','INACTIVE','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_arena_exam_public (public_id),
  KEY idx_arena_exam_eligibility (status,grade,starts_at,ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE exam_target_classes (
  exam_id BIGINT UNSIGNED NOT NULL,
  portal_class_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (exam_id,portal_class_id),
  KEY idx_arena_target_class (portal_class_id,exam_id),
  CONSTRAINT fk_arena_target_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE exam_target_students (
  exam_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (exam_id,student_id),
  CONSTRAINT fk_arena_target_student_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_arena_target_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE questions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  exam_id BIGINT UNSIGNED NOT NULL,
  question_type ENUM('MULTIPLE_CHOICE','MULTIPLE_RESPONSE','SHORT_ANSWER') NOT NULL DEFAULT 'MULTIPLE_CHOICE',
  question_text TEXT NOT NULL,
  option_a TEXT NULL, option_b TEXT NULL, option_c TEXT NULL, option_d TEXT NULL, option_e TEXT NULL,
  correct_answer TEXT NOT NULL,
  points DECIMAL(8,2) NOT NULL DEFAULT 1,
  status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_arena_question_public (public_id),
  KEY idx_arena_question_exam_status (exam_id,status),
  CONSTRAINT fk_arena_question_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE exam_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  exam_id BIGINT UNSIGNED NOT NULL,
  status ENUM('IN_PROGRESS','COMPLETED','TERMINATED','EXPIRED') NOT NULL,
  started_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  question_order JSON NOT NULL,
  option_mapping JSON NOT NULL,
  violation_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_arena_attempt_public (public_id),
  UNIQUE KEY uq_arena_attempt_student_exam (student_id,exam_id),
  KEY idx_arena_attempt_exam_status (exam_id,status),
  KEY idx_arena_attempt_expiry (status,expires_at),
  CONSTRAINT fk_arena_attempt_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT fk_arena_attempt_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attempt_questions (
  attempt_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  question_type VARCHAR(30) NOT NULL,
  question_text TEXT NOT NULL,
  option_a TEXT NULL, option_b TEXT NULL, option_c TEXT NULL, option_d TEXT NULL, option_e TEXT NULL,
  correct_answer TEXT NOT NULL,
  option_mapping JSON NOT NULL,
  points DECIMAL(8,2) NOT NULL,
  PRIMARY KEY (attempt_id,question_id),
  CONSTRAINT fk_arena_snapshot_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE student_answers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attempt_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  answer TEXT NULL,
  is_flagged TINYINT(1) NOT NULL DEFAULT 0,
  answered_at DATETIME(3) NULL,
  UNIQUE KEY uq_arena_answer_attempt_question (attempt_id,question_id),
  CONSTRAINT fk_arena_answer_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE answer_write_versions (
  attempt_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  mutation_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (attempt_id,question_id),
  CONSTRAINT fk_arena_version_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attempt_connections (
  attempt_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  last_seen_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_arena_connection_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE exam_follow_up_meta (
  exam_id BIGINT UNSIGNED PRIMARY KEY,
  source_exam_id BIGINT UNSIGNED NOT NULL,
  type ENUM('SUSULAN','REMEDIAL') NOT NULL,
  room VARCHAR(100) NULL,
  notes TEXT NULL,
  CONSTRAINT fk_arena_follow_up_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_arena_follow_up_source FOREIGN KEY (source_exam_id) REFERENCES exams(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cbt_settings (
  key_name VARCHAR(100) PRIMARY KEY,
  value VARCHAR(500) NOT NULL DEFAULT '',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE exam_results (
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
  UNIQUE KEY uq_arena_result_attempt (attempt_id),
  CONSTRAINT fk_arena_result_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE violations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attempt_id BIGINT UNSIGNED NOT NULL,
  event_key VARCHAR(100) NOT NULL,
  type ENUM('TAB_HIDDEN','WINDOW_BLUR','FULLSCREEN_EXIT','SCREENSHOT_ATTEMPT','COPY_ATTEMPT','SPLIT_SCREEN_SUSPECTED','OTHER') NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_arena_violation_event (attempt_id,event_key),
  CONSTRAINT fk_arena_violation_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

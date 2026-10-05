CREATE TABLE teachers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, portal_teacher_id VARCHAR(64) NOT NULL,
  nip VARCHAR(50) NULL, nuptk VARCHAR(50) NULL, name_snapshot VARCHAR(191) NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', proctor_eligible TINYINT(1) NOT NULL DEFAULT 0,
  last_synced_at DATETIME(3) NULL, UNIQUE KEY uq_arena_teacher_portal(portal_teacher_id), UNIQUE KEY uq_arena_teacher_nip(nip), UNIQUE KEY uq_arena_teacher_nuptk(nuptk)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE employees (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, portal_employee_id VARCHAR(64) NOT NULL,
  nip VARCHAR(50) NULL, name_snapshot VARCHAR(191) NOT NULL, position_snapshot VARCHAR(191) NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', last_synced_at DATETIME(3) NULL,
  UNIQUE KEY uq_arena_employee_portal(portal_employee_id), UNIQUE KEY uq_arena_employee_nip(nip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, teacher_id BIGINT UNSIGNED NULL, employee_id BIGINT UNSIGNED NULL,
  username VARCHAR(100) NOT NULL, password_hash VARCHAR(255) NOT NULL, name VARCHAR(191) NOT NULL,
  role ENUM('ADMIN','TEACHER','EMPLOYEE') NOT NULL, status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_arena_username(username), UNIQUE KEY uq_arena_user_teacher(teacher_id), UNIQUE KEY uq_arena_user_employee(employee_id),
  CONSTRAINT fk_arena_user_teacher FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
  CONSTRAINT fk_arena_user_employee FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE portal_classes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, portal_class_id VARCHAR(64) NOT NULL,
  code VARCHAR(50) NOT NULL, name VARCHAR(191) NOT NULL, grade VARCHAR(10) NULL, academic_year VARCHAR(30) NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', last_synced_at DATETIME(3) NULL,
  UNIQUE KEY uq_arena_class_portal(portal_class_id), KEY idx_arena_class_code(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE portal_academic_years (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, portal_academic_year_id VARCHAR(64) NOT NULL, name VARCHAR(30) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0, last_synced_at DATETIME(3) NULL,
  UNIQUE KEY uq_arena_year_portal(portal_academic_year_id), UNIQUE KEY uq_arena_year_name(name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE portal_semesters (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, portal_semester_id VARCHAR(64) NOT NULL, portal_academic_year_id VARCHAR(64) NOT NULL,
  type ENUM('ODD','EVEN') NOT NULL, academic_year VARCHAR(30) NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 0, last_synced_at DATETIME(3) NULL,
  UNIQUE KEY uq_arena_semester_portal(portal_semester_id), UNIQUE KEY uq_arena_semester_period(portal_academic_year_id,type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE subjects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL, code VARCHAR(30) NOT NULL, name VARCHAR(100) NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', UNIQUE KEY uq_arena_subject_public(public_id), UNIQUE KEY uq_arena_subject_code(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE teacher_exam_assignments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, teacher_id BIGINT UNSIGNED NULL, employee_id BIGINT UNSIGNED NULL, exam_id BIGINT UNSIGNED NULL,
  duty_role ENUM('TEACHER','PROCTOR') NOT NULL DEFAULT 'TEACHER', created_by BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_arena_teacher_exam(teacher_id,exam_id), UNIQUE KEY uq_arena_employee_exam(employee_id,exam_id), KEY idx_arena_assignment_exam(exam_id),
  CONSTRAINT fk_arena_assignment_teacher FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_arena_assignment_employee FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  CONSTRAINT fk_arena_assignment_exam FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_arena_assignment_creator FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE support_tickets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL, student_id BIGINT UNSIGNED NOT NULL,
  exam_id BIGINT UNSIGNED NULL, attempt_id BIGINT UNSIGNED NULL, category ENUM('ACCOUNT_ACCESS','EXAM_LOCKED','PIN','CONNECTION','TECHNICAL','OTHER') NOT NULL,
  message VARCHAR(1000) NOT NULL, status ENUM('OPEN','IN_PROGRESS','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  handled_by BIGINT UNSIGNED NULL, staff_note VARCHAR(1000) NULL, resolution_type ENUM('ASSISTED','CBT_RESET') NULL,
  resolved_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_arena_ticket_public(public_id), KEY idx_arena_ticket_status(status,updated_at), KEY idx_arena_ticket_student(student_id,updated_at),
  CONSTRAINT fk_arena_ticket_student FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT fk_arena_ticket_exam FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE SET NULL,
  CONSTRAINT fk_arena_ticket_attempt FOREIGN KEY(attempt_id) REFERENCES exam_attempts(id) ON DELETE SET NULL,
  CONSTRAINT fk_arena_ticket_handler FOREIGN KEY(handled_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE staff_admin_threads (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL, created_by BIGINT UNSIGNED NOT NULL,
  category ENUM('TECHNICAL','ASSISTANCE','EXAM_REPORT','EMERGENCY','OTHER') NOT NULL, subject VARCHAR(180) NOT NULL,
  status ENUM('OPEN','READ','IN_PROGRESS','RESOLVED') NOT NULL DEFAULT 'OPEN', resolved_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_arena_thread_public(public_id), KEY idx_arena_thread_status(status,updated_at),
  CONSTRAINT fk_arena_thread_creator FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE staff_admin_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, thread_id BIGINT UNSIGNED NOT NULL, sender_user_id BIGINT UNSIGNED NOT NULL,
  message VARCHAR(2000) NOT NULL, attachment_path VARCHAR(255) NULL, read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), KEY idx_arena_message_thread(thread_id,id),
  CONSTRAINT fk_arena_message_thread FOREIGN KEY(thread_id) REFERENCES staff_admin_threads(id) ON DELETE CASCADE,
  CONSTRAINT fk_arena_message_sender FOREIGN KEY(sender_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE portal_sync_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sync_type ENUM('STUDENTS','TEACHERS','EMPLOYEES','CLASSES','ACADEMIC_YEARS','SEMESTERS') NOT NULL,
  started_at DATETIME(3) NOT NULL, finished_at DATETIME(3) NULL,
  status ENUM('RUNNING','SUCCESS','FAILED','PARTIAL') NOT NULL,
  total INT UNSIGNED NOT NULL DEFAULT 0, inserted_count INT UNSIGNED NOT NULL DEFAULT 0, updated_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0, error_summary TEXT NULL, initiated_by BIGINT UNSIGNED NULL,
  KEY idx_arena_sync_type_time(sync_type,started_at), CONSTRAINT fk_arena_sync_actor FOREIGN KEY(initiated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, actor_user_id BIGINT UNSIGNED NULL, actor_role VARCHAR(30) NULL,
  action VARCHAR(100) NOT NULL, entity_type VARCHAR(100) NULL, entity_id VARCHAR(64) NULL,
  before_data JSON NULL, after_data JSON NULL, ip_address VARCHAR(45) NULL, user_agent VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), KEY idx_arena_audit_time(created_at), KEY idx_arena_audit_entity(entity_type,entity_id),
  CONSTRAINT fk_arena_audit_actor FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

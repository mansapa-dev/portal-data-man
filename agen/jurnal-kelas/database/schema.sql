SET NAMES utf8mb4;
SET time_zone = '+07:00';

CREATE TABLE IF NOT EXISTS users (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL UNIQUE, portal_teacher_public_id CHAR(26) NULL UNIQUE,
 name_snapshot VARCHAR(150) NOT NULL, email_snapshot VARCHAR(191) NULL, role ENUM('ADMIN','TEACHER','AUDITOR') NOT NULL,
 status ENUM('ACTIVE','INACTIVE','LOCKED') NOT NULL DEFAULT 'ACTIVE', last_login_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 INDEX idx_users_role_status(role,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL UNIQUE, user_id BIGINT UNSIGNED NOT NULL,
 token_hash CHAR(64) NOT NULL UNIQUE, csrf_token_hash CHAR(64) NOT NULL, ip_address VARCHAR(45) NULL, user_agent VARCHAR(500) NULL,
 last_used_at DATETIME(3) NOT NULL, expires_at DATETIME(3) NOT NULL, revoked_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_sessions_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE, INDEX idx_sessions_active(user_id,expires_at,revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subjects (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL UNIQUE, code VARCHAR(50) NOT NULL UNIQUE, name VARCHAR(150) NOT NULL,
 status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), deleted_at DATETIME(3) NULL,
 INDEX idx_subjects_status_name(status,name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_sessions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL UNIQUE, journal_id BIGINT UNSIGNED NULL UNIQUE,
 attendance_date DATE NOT NULL, class_public_id CHAR(26) NOT NULL, class_name_snapshot VARCHAR(150) NOT NULL,
 academic_year_public_id CHAR(26) NOT NULL, academic_year_snapshot VARCHAR(50) NOT NULL, semester_public_id CHAR(26) NOT NULL, semester_snapshot VARCHAR(50) NOT NULL,
 teacher_public_id CHAR(26) NOT NULL, teacher_name_snapshot VARCHAR(150) NOT NULL, subject_id BIGINT UNSIGNED NOT NULL, subject_name_snapshot VARCHAR(150) NOT NULL,
 period_start TINYINT UNSIGNED NOT NULL, period_end TINYINT UNSIGNED NOT NULL, status ENUM('DRAFT','FINAL') NOT NULL DEFAULT 'DRAFT', finalized_at DATETIME(3) NULL,
 created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT chk_attendance_period CHECK(period_start BETWEEN 1 AND 11 AND period_end BETWEEN period_start AND 11),
 CONSTRAINT fk_attendance_subject FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT fk_attendance_creator FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 INDEX idx_attendance_filter(attendance_date,class_public_id,teacher_public_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_records (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL UNIQUE, attendance_session_id BIGINT UNSIGNED NOT NULL,
 student_public_id CHAR(26) NOT NULL, nisn_snapshot VARCHAR(20) NOT NULL, student_name_snapshot VARCHAR(150) NOT NULL, attendance_number_snapshot SMALLINT UNSIGNED NULL,
 status ENUM('PRESENT','SICK','PERMITTED','ABSENT','NOT_PARTICIPATING','UNMARKED') NOT NULL DEFAULT 'UNMARKED', method ENUM('BARCODE','MANUAL','SYSTEM') NOT NULL,
 scanned_at DATETIME(3) NULL, marked_at DATETIME(3) NULL, marked_by BIGINT UNSIGNED NOT NULL, note VARCHAR(500) NULL, correction_reason VARCHAR(500) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT uq_attendance_student UNIQUE(attendance_session_id,student_public_id),
 CONSTRAINT fk_record_session FOREIGN KEY(attendance_session_id) REFERENCES attendance_sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT fk_record_marker FOREIGN KEY(marked_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 INDEX idx_record_summary(attendance_session_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS journals (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL UNIQUE, journal_number VARCHAR(50) NOT NULL UNIQUE, attendance_session_id BIGINT UNSIGNED NOT NULL UNIQUE,
 journal_date DATE NOT NULL, class_public_id CHAR(26) NOT NULL, class_name_snapshot VARCHAR(150) NOT NULL, teacher_public_id CHAR(26) NOT NULL, teacher_name_snapshot VARCHAR(150) NOT NULL,
 subject_id BIGINT UNSIGNED NOT NULL, subject_name_snapshot VARCHAR(150) NOT NULL, period_start TINYINT UNSIGNED NOT NULL, period_end TINYINT UNSIGNED NOT NULL,
 activity_type ENUM('MATERIAL','PRACTICE','DISCUSSION','ASSIGNMENT','TEST','REMEDIAL','ENRICHMENT','OTHER') NOT NULL,
 topic TEXT NOT NULL, teacher_note TEXT NULL, status ENUM('DRAFT','FINAL','AMENDED') NOT NULL DEFAULT 'DRAFT', finalized_at DATETIME(3) NULL,
 created_by BIGINT UNSIGNED NOT NULL, updated_by BIGINT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), deleted_at DATETIME(3) NULL,
 CONSTRAINT chk_journal_period CHECK(period_start BETWEEN 1 AND 11 AND period_end BETWEEN period_start AND 11),
 CONSTRAINT fk_journal_attendance FOREIGN KEY(attendance_session_id) REFERENCES attendance_sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT fk_journal_subject FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT fk_journal_creator FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT fk_journal_updater FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 INDEX idx_journals_filter(journal_date,class_public_id,teacher_public_id,status), FULLTEXT INDEX ftx_journal_topic(topic)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE attendance_sessions ADD CONSTRAINT fk_attendance_journal FOREIGN KEY(journal_id) REFERENCES journals(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS journal_documentations (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL UNIQUE, journal_id BIGINT UNSIGNED NOT NULL,
 storage_disk VARCHAR(30) NOT NULL DEFAULT 'private', storage_path VARCHAR(500) NOT NULL UNIQUE, original_name VARCHAR(255) NOT NULL, generated_name VARCHAR(100) NOT NULL UNIQUE,
 mime_type VARCHAR(100) NOT NULL, file_size INT UNSIGNED NOT NULL, checksum CHAR(64) NOT NULL, uploaded_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), deleted_at DATETIME(3) NULL,
 CONSTRAINT fk_doc_journal FOREIGN KEY(journal_id) REFERENCES journals(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT fk_doc_uploader FOREIGN KEY(uploaded_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE, INDEX idx_doc_journal(journal_id,deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS journal_revisions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL UNIQUE, journal_id BIGINT UNSIGNED NOT NULL, revision_number INT UNSIGNED NOT NULL,
 reason VARCHAR(1000) NOT NULL, before_data_json JSON NOT NULL, after_data_json JSON NOT NULL, revised_by BIGINT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT uq_journal_revision UNIQUE(journal_id,revision_number), CONSTRAINT fk_revision_journal FOREIGN KEY(journal_id) REFERENCES journals(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT fk_revision_user FOREIGN KEY(revised_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_data_cache (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cache_key VARCHAR(191) NOT NULL UNIQUE, entity_type VARCHAR(50) NOT NULL, public_id CHAR(26) NULL,
 payload_json JSON NOT NULL, checksum CHAR(64) NOT NULL, synced_at DATETIME(3) NOT NULL, expires_at DATETIME(3) NOT NULL,
 INDEX idx_portal_cache_entity(entity_type,public_id), INDEX idx_portal_cache_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS application_settings (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, setting_key VARCHAR(100) NOT NULL UNIQUE, setting_value TEXT NOT NULL, setting_type ENUM('STRING','INTEGER','BOOLEAN','JSON') NOT NULL,
 updated_by BIGINT UNSIGNED NULL, updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_setting_user FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL UNIQUE, actor_public_id CHAR(26) NULL, actor_name_snapshot VARCHAR(150) NULL,
 actor_role ENUM('ADMIN','TEACHER','AUDITOR','SYSTEM') NOT NULL, action VARCHAR(100) NOT NULL, entity_type VARCHAR(100) NULL, entity_public_id CHAR(26) NULL,
 before_json JSON NULL, after_json JSON NULL, metadata_json JSON NULL, ip_address VARCHAR(45) NULL, user_agent VARCHAR(500) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX idx_audit_entity(entity_type,entity_public_id), INDEX idx_audit_actor(actor_public_id,created_at), INDEX idx_audit_created(created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

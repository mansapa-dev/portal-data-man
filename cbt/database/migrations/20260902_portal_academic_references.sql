CREATE TABLE IF NOT EXISTS portal_academic_years (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 portal_academic_year_id VARCHAR(64) NOT NULL,
 name VARCHAR(30) NOT NULL,
 is_active TINYINT(1) NOT NULL DEFAULT 0,
 last_synced_at DATETIME(3) NULL,
 UNIQUE KEY uq_academic_years_portal (portal_academic_year_id),
 UNIQUE KEY uq_academic_years_name (name),
 KEY idx_academic_years_active (is_active)
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
 UNIQUE KEY uq_semesters_period (portal_academic_year_id,type),
 KEY idx_semesters_active (is_active)
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

ALTER TABLE exams ADD COLUMN IF NOT EXISTS portal_academic_year_id VARCHAR(64) NULL AFTER public_id;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS portal_semester_id VARCHAR(64) NULL AFTER portal_academic_year_id;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS subject_id BIGINT UNSIGNED NULL AFTER portal_semester_id;
ALTER TABLE portal_sync_logs MODIFY sync_type ENUM('STUDENTS','TEACHERS','CLASSES','ACADEMIC_YEARS','SEMESTERS','ALL') NOT NULL;

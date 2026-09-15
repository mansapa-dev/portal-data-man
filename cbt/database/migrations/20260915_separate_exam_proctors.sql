CREATE TABLE IF NOT EXISTS employees (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 portal_employee_id VARCHAR(64) NOT NULL,
 nip VARCHAR(50) NULL,
 name_snapshot VARCHAR(191) NOT NULL,
 position_snapshot VARCHAR(191) NULL,
 status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
 last_synced_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_employees_portal (portal_employee_id),
 UNIQUE KEY uq_employees_nip (nip),
 KEY idx_employees_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS proctor_eligible TINYINT(1) NOT NULL DEFAULT 0 AFTER status;
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id BIGINT UNSIGNED NULL AFTER teacher_id;
ALTER TABLE users MODIFY role ENUM('ADMIN','TEACHER','EMPLOYEE') NOT NULL;
ALTER TABLE users ADD UNIQUE KEY uq_users_employee (employee_id);
ALTER TABLE users ADD CONSTRAINT fk_users_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE teacher_exam_assignments MODIFY teacher_id BIGINT UNSIGNED NULL;
ALTER TABLE teacher_exam_assignments ADD COLUMN IF NOT EXISTS employee_id BIGINT UNSIGNED NULL AFTER teacher_id;
ALTER TABLE teacher_exam_assignments ADD UNIQUE KEY uq_employee_exam (employee_id,exam_id);
ALTER TABLE teacher_exam_assignments ADD CONSTRAINT fk_assignment_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;

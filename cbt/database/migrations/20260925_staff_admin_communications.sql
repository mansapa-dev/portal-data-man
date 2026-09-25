CREATE TABLE IF NOT EXISTS staff_admin_threads (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, public_id CHAR(26) NOT NULL, created_by BIGINT UNSIGNED NOT NULL,
 category ENUM('TECHNICAL','ASSISTANCE','EXAM_REPORT','EMERGENCY','OTHER') NOT NULL, subject VARCHAR(180) NOT NULL,
 status ENUM('OPEN','READ','IN_PROGRESS','RESOLVED') NOT NULL DEFAULT 'OPEN', resolved_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_staff_admin_thread_public(public_id), KEY idx_staff_admin_thread_status(status,updated_at),
 CONSTRAINT fk_staff_admin_thread_creator FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS staff_admin_messages (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, thread_id BIGINT UNSIGNED NOT NULL, sender_user_id BIGINT UNSIGNED NOT NULL,
 message VARCHAR(2000) NOT NULL, attachment_path VARCHAR(255) NULL, read_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), KEY idx_staff_admin_message_thread(thread_id,id),
 CONSTRAINT fk_staff_admin_message_thread FOREIGN KEY(thread_id) REFERENCES staff_admin_threads(id) ON DELETE CASCADE,
 CONSTRAINT fk_staff_admin_message_sender FOREIGN KEY(sender_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

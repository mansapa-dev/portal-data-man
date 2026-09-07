CREATE TABLE IF NOT EXISTS attempt_connections (
 attempt_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 last_seen_at DATETIME(3) NOT NULL,
 CONSTRAINT fk_attempt_connection FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

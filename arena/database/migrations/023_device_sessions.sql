CREATE TABLE exam_device_sessions (
  attempt_id BIGINT UNSIGNED PRIMARY KEY,
  device_category ENUM('MOBILE','TABLET','DESKTOP','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  browser_family VARCHAR(50) NULL,
  os_family VARCHAR(50) NULL,
  screen_width SMALLINT UNSIGNED NULL,
  screen_height SMALLINT UNSIGNED NULL,
  camera_available TINYINT(1) NULL,
  recording_capable TINYINT(1) NULL,
  recording_mime_type VARCHAR(100) NULL,
  fullscreen_capable TINYINT(1) NULL,
  wake_lock_capable TINYINT(1) NULL,
  network_type VARCHAR(30) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)) ON UPDATE (UTC_TIMESTAMP(3)),
  CONSTRAINT fk_arena_device_session_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

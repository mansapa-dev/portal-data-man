CREATE TABLE exam_recording_access_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  segment_id BIGINT UNSIGNED NOT NULL,
  accessed_by BIGINT UNSIGNED NOT NULL,
  accessed_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  access_type ENUM('PRESIGNED_URL_GENERATED','PLAYBACK','DOWNLOAD') NOT NULL DEFAULT 'PRESIGNED_URL_GENERATED',
  ip_address VARCHAR(45) NULL,
  KEY idx_arena_rec_access_segment (segment_id, accessed_at),
  KEY idx_arena_rec_access_user (accessed_by, accessed_at),
  CONSTRAINT fk_arena_rec_access_segment FOREIGN KEY (segment_id) REFERENCES exam_recording_segments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

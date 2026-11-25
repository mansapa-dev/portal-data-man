-- exam_recording_sessions: one per exam attempt when recording is enabled
CREATE TABLE exam_recording_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  attempt_id BIGINT UNSIGNED NOT NULL,
  exam_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  status ENUM('ACTIVE','FINALIZED','INTERRUPTED','ABANDONED') NOT NULL DEFAULT 'ACTIVE',
  started_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  finalized_at DATETIME(3) NULL,
  total_segments SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  uploaded_segments SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  missing_segments SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)) ON UPDATE (UTC_TIMESTAMP(3)),
  UNIQUE KEY uq_arena_rec_session_public (public_id),
  UNIQUE KEY uq_arena_rec_session_attempt (attempt_id),
  KEY idx_arena_rec_session_exam_status (exam_id, status),
  KEY idx_arena_rec_session_student (student_id),
  CONSTRAINT fk_arena_rec_session_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE,
  CONSTRAINT fk_arena_rec_session_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_arena_rec_session_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE exam_recording_segments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  sequence_number SMALLINT UNSIGNED NOT NULL,
  object_key VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size_bytes INT UNSIGNED NULL,
  upload_status ENUM('PENDING','UPLOADED','FAILED','MISSING') NOT NULL DEFAULT 'PENDING',
  segment_started_at DATETIME(3) NULL,
  segment_ended_at DATETIME(3) NULL,
  upload_confirmed_at DATETIME(3) NULL,
  presigned_expires_at DATETIME(3) NULL,
  retry_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)) ON UPDATE (UTC_TIMESTAMP(3)),
  UNIQUE KEY uq_arena_rec_segment_key (object_key),
  UNIQUE KEY uq_arena_rec_segment_seq (session_id, sequence_number),
  KEY idx_arena_rec_segment_status (upload_status, session_id),
  CONSTRAINT fk_arena_rec_segment_session FOREIGN KEY (session_id) REFERENCES exam_recording_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

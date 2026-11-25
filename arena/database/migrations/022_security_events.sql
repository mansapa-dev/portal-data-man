-- exam_security_events: enriched event log beyond violations table
-- Violations table is preserved for backward compat; security_events adds
-- metadata, risk scoring, and review workflow.
CREATE TABLE exam_security_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  exam_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  severity ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  client_occurred_at DATETIME(3) NULL,
  server_occurred_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  duration_ms INT UNSIGNED NULL,
  risk_weight SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  metadata JSON NULL,
  recording_segment_id BIGINT UNSIGNED NULL,
  review_status ENUM('PENDING','REVIEWED','DISMISSED','ESCALATED') NOT NULL DEFAULT 'PENDING',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  review_notes TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  UNIQUE KEY uq_arena_sec_event_key (attempt_id, event_key),
  KEY idx_arena_sec_event_type (event_type, server_occurred_at),
  KEY idx_arena_sec_event_exam (exam_id, server_occurred_at),
  KEY idx_arena_sec_event_severity (severity, review_status),
  KEY idx_arena_sec_event_attempt (attempt_id, server_occurred_at),
  CONSTRAINT fk_arena_sec_event_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE,
  CONSTRAINT fk_arena_sec_event_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT fk_arena_sec_event_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Risk score cache per attempt (recomputed on event ingestion)
CREATE TABLE exam_attempt_risk_scores (
  attempt_id BIGINT UNSIGNED PRIMARY KEY,
  total_score SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  event_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  high_severity_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_event_at DATETIME(3) NULL,
  computed_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  CONSTRAINT fk_arena_risk_score_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

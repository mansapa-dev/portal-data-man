-- Additive. Apply once before enabling the FIFO waiting room.
CREATE TABLE exam_waiting_settings (
  exam_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  queue_open TINYINT(1) NOT NULL DEFAULT 1,
  batch_size SMALLINT UNSIGNED NOT NULL DEFAULT 300,
  batch_interval_ms INT UNSIGNED NOT NULL DEFAULT 10000,
  heartbeat_timeout_ms INT UNSIGNED NOT NULL DEFAULT 90000,
  claim_timeout_ms INT UNSIGNED NOT NULL DEFAULT 120000,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_waiting_settings_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE exam_waiting_claims (
  exam_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  attempt_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  queue_sequence BIGINT UNSIGNED NULL,
  state ENUM('IN_EXAM','FINISHED') NOT NULL DEFAULT 'IN_EXAM',
  claimed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (exam_id,student_id),
  UNIQUE KEY uq_waiting_claim_attempt(attempt_id),
  KEY idx_waiting_claim_state(exam_id,state),
  CONSTRAINT fk_waiting_claim_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE RESTRICT,
  CONSTRAINT fk_waiting_claim_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT fk_waiting_claim_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

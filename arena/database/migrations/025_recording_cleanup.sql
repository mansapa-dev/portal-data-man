ALTER TABLE exam_recording_sessions
  ADD COLUMN retain_until DATETIME(3) NULL AFTER finalized_at,
  ADD COLUMN legal_hold TINYINT(1) NOT NULL DEFAULT 0 AFTER retain_until,
  ADD COLUMN cleanup_status ENUM('PENDING','COMPLETED','FAILED','HELD') NOT NULL DEFAULT 'PENDING' AFTER legal_hold,
  ADD COLUMN cleanup_attempted_at DATETIME(3) NULL AFTER cleanup_status,
  ADD KEY idx_arena_rec_cleanup (cleanup_status, retain_until);

-- Match the predicates and sort order used by the teacher journal list,
-- dashboard, and "available attendance" API.  These indexes are additive and
-- safe for existing deployments through database/migrate.php.
ALTER TABLE journals
  ADD INDEX idx_journals_teacher_recent (teacher_public_id, deleted_at, journal_date, created_at),
  ADD INDEX idx_journals_teacher_status_recent (teacher_public_id, deleted_at, status, journal_date, created_at),
  ADD INDEX idx_journals_teacher_updated (teacher_public_id, deleted_at, updated_at);

ALTER TABLE attendance_sessions
  ADD INDEX idx_attendance_teacher_status_date (teacher_public_id, status, attendance_date);

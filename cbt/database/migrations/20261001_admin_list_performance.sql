ALTER TABLE exam_attempts
 ADD INDEX idx_attempt_student_updated (student_id,updated_at,id);

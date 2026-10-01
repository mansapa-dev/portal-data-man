ALTER TABLE exam_target_classes
 ADD INDEX idx_exam_target_classes_class (portal_class_id,exam_id);

ALTER TABLE exam_attempts
 ADD INDEX idx_attempt_live (exam_id,status,expires_at,id);

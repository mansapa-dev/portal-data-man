-- Optimize support ticket deduplication and student exam status lookups
SET @add_ticket_lookup_index = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='support_tickets' AND index_name='idx_arena_ticket_student_lookup'),
  'SELECT 1',
  'ALTER TABLE support_tickets ADD KEY idx_arena_ticket_student_lookup (student_id,status,category,exam_id)'
);
PREPARE arena_index_stmt FROM @add_ticket_lookup_index;
EXECUTE arena_index_stmt;
DEALLOCATE PREPARE arena_index_stmt;

SET @add_attempt_heartbeat_index = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='exam_attempts' AND index_name='idx_arena_attempt_heartbeat'),
  'SELECT 1',
  'ALTER TABLE exam_attempts ADD KEY idx_arena_attempt_heartbeat (student_id,exam_id,status,expires_at)'
);
PREPARE arena_index_stmt FROM @add_attempt_heartbeat_index;
EXECUTE arena_index_stmt;
DEALLOCATE PREPARE arena_index_stmt;

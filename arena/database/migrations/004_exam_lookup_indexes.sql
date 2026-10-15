-- Safe to run whether the baseline migration already created these indexes or not.
SET @add_attempt_status_index = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='exam_attempts' AND index_name='idx_arena_attempt_student_status'),
  'SELECT 1',
  'ALTER TABLE exam_attempts ADD KEY idx_arena_attempt_student_status (student_id,status,expires_at)'
);
PREPARE arena_index_stmt FROM @add_attempt_status_index;
EXECUTE arena_index_stmt;
DEALLOCATE PREPARE arena_index_stmt;

SET @add_attempt_live_updated_index = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='exam_attempts' AND index_name='idx_arena_attempt_live_updated'),
  'SELECT 1',
  'ALTER TABLE exam_attempts ADD KEY idx_arena_attempt_live_updated (status,updated_at,id)'
);
PREPARE arena_index_stmt FROM @add_attempt_live_updated_index;
EXECUTE arena_index_stmt;
DEALLOCATE PREPARE arena_index_stmt;

SET @add_violation_time_index = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='violations' AND index_name='idx_arena_violation_time'),
  'SELECT 1',
  'ALTER TABLE violations ADD KEY idx_arena_violation_time (occurred_at,id)'
);
PREPARE arena_index_stmt FROM @add_violation_time_index;
EXECUTE arena_index_stmt;
DEALLOCATE PREPARE arena_index_stmt;

SET @add_violation_attempt_time_index = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='violations' AND index_name='idx_arena_violation_attempt_time'),
  'SELECT 1',
  'ALTER TABLE violations ADD KEY idx_arena_violation_attempt_time (attempt_id,occurred_at)'
);
PREPARE arena_index_stmt FROM @add_violation_attempt_time_index;
EXECUTE arena_index_stmt;
DEALLOCATE PREPARE arena_index_stmt;

SET @add_attempt_question_index = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='attempt_questions' AND index_name='idx_arena_attempt_question'),
  'SELECT 1',
  'ALTER TABLE attempt_questions ADD KEY idx_arena_attempt_question (question_id,attempt_id)'
);
PREPARE arena_index_stmt FROM @add_attempt_question_index;
EXECUTE arena_index_stmt;
DEALLOCATE PREPARE arena_index_stmt;

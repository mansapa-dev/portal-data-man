-- Apply before deploying the new API/workers. Repeatable, additive migration.

SET @arena_ddl = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='exam_attempts' AND column_name='termination_action'), 'SELECT 1', 'ALTER TABLE exam_attempts ADD COLUMN termination_action ENUM(''AUTO_SUBMIT'',''LOCK'') NULL');
PREPARE arena_stmt FROM @arena_ddl;
EXECUTE arena_stmt;
DEALLOCATE PREPARE arena_stmt;

SET @arena_ddl = IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='exam_attempts' AND index_name='idx_arena_attempt_finalization'), 'SELECT 1', 'ALTER TABLE exam_attempts ADD INDEX idx_arena_attempt_finalization (status,termination_action,expires_at,id)');
PREPARE arena_stmt FROM @arena_ddl;
EXECUTE arena_stmt;
DEALLOCATE PREPARE arena_stmt;

-- Preserve unresolved legacy terminations conservatively: an administrator must
-- review these rather than silently finalize a previously LOCKed attempt.
UPDATE exam_attempts a SET termination_action='LOCK' WHERE status='TERMINATED' AND termination_action IS NULL AND NOT EXISTS (SELECT 1 FROM exam_results r WHERE r.attempt_id=a.id);

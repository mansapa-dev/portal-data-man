-- Read-only MySQL 8 diagnostics. USE the CBT database first. Capture twice over
-- the same load interval and subtract counters; never TRUNCATE global summaries.
SELECT VERSION() mysql_version, @@transaction_isolation isolation_level,
       @@innodb_flush_log_at_trx_commit flush_policy, @@sync_binlog sync_binlog;

SHOW GLOBAL STATUS WHERE Variable_name IN
 ('Threads_connected','Threads_running','Connections','Innodb_row_lock_waits',
  'Innodb_row_lock_time','Innodb_row_lock_time_max','Innodb_log_waits');

SELECT SCHEMA_NAME,DIGEST,DIGEST_TEXT,COUNT_STAR,
       SUM_TIMER_WAIT/1e9 total_ms,AVG_TIMER_WAIT/1e9 avg_ms,
       SUM_LOCK_TIME/1e9 statement_lock_ms,SUM_ROWS_EXAMINED,SUM_ROWS_AFFECTED
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME=DATABASE()
ORDER BY SUM_TIMER_WAIT DESC LIMIT 30;

SELECT EVENT_NAME,COUNT_STAR,SUM_TIMER_WAIT/1e9 total_ms,AVG_TIMER_WAIT/1e9 avg_ms
FROM performance_schema.events_statements_summary_global_by_event_name
WHERE EVENT_NAME IN ('statement/sql/commit','statement/sql/begin');

-- Statement LOCK_TIME is not a substitute for InnoDB row-lock wait time.
-- No answer values, statement SQL_TEXT, credentials or lock record values.
SELECT waiting.OBJECT_SCHEMA,waiting.OBJECT_NAME,waiting.INDEX_NAME,
       waiting.LOCK_TYPE,waiting.LOCK_MODE waiting_mode,blocking.LOCK_MODE blocking_mode,
       w.REQUESTING_THREAD_ID,w.BLOCKING_THREAD_ID,
       waiting.ENGINE_TRANSACTION_ID waiting_transaction,
       blocking.ENGINE_TRANSACTION_ID blocking_transaction
FROM performance_schema.data_lock_waits w
JOIN performance_schema.data_locks waiting
 ON waiting.ENGINE=w.ENGINE AND waiting.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
JOIN performance_schema.data_locks blocking
 ON blocking.ENGINE=w.ENGINE AND blocking.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID
WHERE waiting.OBJECT_SCHEMA=DATABASE();

SELECT trx_id,trx_state,trx_started,trx_wait_started,trx_mysql_thread_id,
       trx_rows_locked,trx_rows_modified
FROM information_schema.innodb_trx ORDER BY trx_started;

SELECT OBJECT_TYPE,OBJECT_SCHEMA,OBJECT_NAME,LOCK_TYPE,LOCK_DURATION,LOCK_STATUS,OWNER_THREAD_ID
FROM performance_schema.metadata_locks
WHERE OBJECT_SCHEMA=DATABASE() AND LOCK_STATUS='PENDING';

-- Replace fixture IDs with valid diagnostic IDs. EXPLAIN does not execute the
-- locking read. Do not EXPLAIN ANALYZE a locking query on the live exam.
EXPLAIN SELECT id,public_id,status,expires_at FROM exam_attempts
 WHERE student_id=1 AND exam_id=1 LIMIT 1 FOR UPDATE;
EXPLAIN SELECT t.id,t.public_id,q.question_type,v.revision,v.mutation_id,a.answer,a.is_flagged
 FROM exam_attempts t
 LEFT JOIN attempt_questions q ON q.attempt_id=t.id AND q.question_id=1
 LEFT JOIN answer_write_versions v ON v.attempt_id=q.attempt_id AND v.question_id=q.question_id
 LEFT JOIN student_answers a ON a.attempt_id=q.attempt_id AND a.question_id=q.question_id
 WHERE t.student_id=1 AND t.exam_id=1;

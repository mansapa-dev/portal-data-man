-- Durable async exam submission (Tahap 2).
--
-- `exam_submissions` adalah record penerimaan submission yang durable di MySQL
-- (sumber kebenaran acceptance — BullMQ hanya akselerator eksekusi). Satu
-- attempt tepat satu keputusan submission (UNIQUE attempt_id):
--   RECEIVED   : TX1 submit commit; jawaban dibekukan lewat
--                exam_attempts.submitted_at (kolom di bawah).
--   PROCESSING : worker memegang lease (claim_token + lease_expires_at);
--                fencing semua tulisan state berbasis claim_token.
--   DONE       : scoring commit; exam_results tepat satu (idempotency boundary).
--   SKIPPED    : terminal — skip_reason: 'lock' | 'not_found' |
--                'snapshot_missing' | 'lease_exhausted' | 'rejected'.
-- Tidak ada baris submission untuk attempt TERMINATED+LOCK: TX1 menolak 409
-- sebelum INSERT (semantik scoring.submitOnce).
--
-- `exam_attempts.submitted_at` adalah freeze marker jawaban: dibaca oleh kedua
-- jalur autosave melalui locking read (`FOR SHARE OF ea` / `FOR UPDATE`) pada
-- baris yang sama, sehingga guard selalu versi ter-commit terbaru (tidak bisa
-- stale oleh MVCC snapshot). Dibersihkan hanya oleh admin reset.
--
-- Idempotent dan aditif; aman diulang. Rollback: database/rollbacks/016_exam_submissions.sql
-- (hanya setelah kode yang membaca kolom ini dilepas).

SET @arena_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='exam_submissions'),
  'SELECT 1',
  'CREATE TABLE exam_submissions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    attempt_id BIGINT UNSIGNED NOT NULL,
    student_id BIGINT UNSIGNED NOT NULL,
    exam_id BIGINT UNSIGNED NOT NULL,
    state ENUM(''RECEIVED'',''PROCESSING'',''DONE'',''SKIPPED'') NOT NULL,
    skip_reason VARCHAR(100) NULL,
    accepted_status ENUM(''IN_PROGRESS'',''TERMINATED'') NOT NULL,
    accepted_expired TINYINT(1) NOT NULL,
    received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    claim_token CHAR(32) NULL,
    lease_expires_at DATETIME(3) NULL,
    lease_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    processing_at DATETIME(3) NULL,
    finalized_at DATETIME(3) NULL,
    UNIQUE KEY uq_arena_submission_attempt (attempt_id),
    KEY idx_arena_submission_reconcile (state, lease_expires_at, received_at),
    CONSTRAINT fk_arena_submission_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);
PREPARE arena_ddl_stmt FROM @arena_ddl;
EXECUTE arena_ddl_stmt;
DEALLOCATE PREPARE arena_ddl_stmt;

SET @arena_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='exam_attempts' AND column_name='submitted_at'),
  'SELECT 1',
  'ALTER TABLE exam_attempts ADD COLUMN submitted_at DATETIME(3) NULL'
);
PREPARE arena_ddl_stmt FROM @arena_ddl;
EXECUTE arena_ddl_stmt;
DEALLOCATE PREPARE arena_ddl_stmt;

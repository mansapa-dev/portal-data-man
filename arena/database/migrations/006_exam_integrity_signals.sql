-- Add observable browser signals and server-side request context without changing
-- existing violation rows or their idempotency keys.
ALTER TABLE violations
  MODIFY type ENUM(
    'TAB_HIDDEN','WINDOW_BLUR','FULLSCREEN_EXIT','SCREENSHOT_ATTEMPT','COPY_ATTEMPT',
    'PASTE_ATTEMPT','CUT_ATTEMPT','CONTEXT_MENU_ATTEMPT','DEVTOOLS_SHORTCUT','BROWSER_SHORTCUT',
    'SPLIT_SCREEN_SUSPECTED','OTHER'
  ) NOT NULL;

SET @add_violation_client_time = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='violations' AND column_name='client_occurred_at'),
  'SELECT 1',
  'ALTER TABLE violations ADD COLUMN client_occurred_at DATETIME(3) NULL AFTER occurred_at'
);
PREPARE arena_integrity_stmt FROM @add_violation_client_time;
EXECUTE arena_integrity_stmt;
DEALLOCATE PREPARE arena_integrity_stmt;

SET @add_violation_ip = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='violations' AND column_name='ip_address'),
  'SELECT 1',
  'ALTER TABLE violations ADD COLUMN ip_address VARCHAR(45) NULL AFTER client_occurred_at'
);
PREPARE arena_integrity_stmt FROM @add_violation_ip;
EXECUTE arena_integrity_stmt;
DEALLOCATE PREPARE arena_integrity_stmt;

SET @add_violation_user_agent = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='violations' AND column_name='user_agent'),
  'SELECT 1',
  'ALTER TABLE violations ADD COLUMN user_agent VARCHAR(500) NULL AFTER ip_address'
);
PREPARE arena_integrity_stmt FROM @add_violation_user_agent;
EXECUTE arena_integrity_stmt;
DEALLOCATE PREPARE arena_integrity_stmt;

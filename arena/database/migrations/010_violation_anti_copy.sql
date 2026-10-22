-- Anti-copy / long-press signal hardening: TEXT_SELECTION type, per-event question
-- number, and a roll-up flag so every 3 low-confidence signals of the same type
-- (TEXT_SELECTION, CONTEXT_MENU_ATTEMPT) become 1 counted violation server-side.
ALTER TABLE violations
  MODIFY type ENUM(
    'TAB_HIDDEN','WINDOW_BLUR','FULLSCREEN_EXIT','SCREENSHOT_ATTEMPT','COPY_ATTEMPT',
    'PASTE_ATTEMPT','CUT_ATTEMPT','CONTEXT_MENU_ATTEMPT','DEVTOOLS_SHORTCUT','BROWSER_SHORTCUT',
    'SPLIT_SCREEN_SUSPECTED','MULTI_TAB','TEXT_SELECTION','OTHER'
  ) NOT NULL;

SET @add_violation_question_no = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='violations' AND column_name='question_no'),
  'SELECT 1',
  'ALTER TABLE violations ADD COLUMN question_no SMALLINT UNSIGNED NULL AFTER user_agent'
);
PREPARE arena_copy_stmt FROM @add_violation_question_no;
EXECUTE arena_copy_stmt;
DEALLOCATE PREPARE arena_copy_stmt;

SET @add_violation_rolled_up = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='violations' AND column_name='rolled_up'),
  'SELECT 1',
  'ALTER TABLE violations ADD COLUMN rolled_up TINYINT(1) NOT NULL DEFAULT 0 AFTER question_no'
);
PREPARE arena_copy_stmt FROM @add_violation_rolled_up;
EXECUTE arena_copy_stmt;
DEALLOCATE PREPARE arena_copy_stmt;

-- Counting soft roll-ups needs a narrow lookup; keeps the COUNT cheap even with
-- thousands of concurrent sessions (attempt_id first = per-attempt working set).
SET @add_violation_rollup_index = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='violations' AND index_name='idx_arena_violation_rollup'),
  'SELECT 1',
  'ALTER TABLE violations ADD KEY idx_arena_violation_rollup (attempt_id,type,rolled_up)'
);
PREPARE arena_copy_stmt FROM @add_violation_rollup_index;
EXECUTE arena_copy_stmt;
DEALLOCATE PREPARE arena_copy_stmt;

-- Termination policy after 2-3 counted violations: AUTO_SUBMIT finalizes scores like
-- an expiry, LOCK terminates without publishing results (admin reset still possible).
INSERT INTO cbt_settings(key_name,value)
  VALUES('violation_action','AUTO_SUBMIT')
  ON DUPLICATE KEY UPDATE value=value;

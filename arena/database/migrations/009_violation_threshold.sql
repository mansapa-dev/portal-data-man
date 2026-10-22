-- Violation termination threshold: after 2 or 3 counted integrity violations
-- (TAB_HIDDEN, WINDOW_BLUR, FULLSCREEN_EXIT, SCREENSHOT_ATTEMPT, COPY_ATTEMPT,
-- MULTI_TAB, SPLIT_SCREEN_SUSPECTED) the attempt is TERMINATED and only an
-- administrator may recover the session. Default: 3.
INSERT INTO cbt_settings(key_name,value)
  VALUES('violation_termination_threshold','3')
  ON DUPLICATE KEY UPDATE value=value;

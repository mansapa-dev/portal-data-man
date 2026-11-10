-- APP_OVERLAY: Android assistant/overlay (Gemini, Circle to Search, vendor assistant)
-- appearing above the exam web view. The secure Android shell dispatches an
-- "arena-host-hidden" event to the page whenever the host pauses or loses window
-- focus; the page reports it as APP_OVERLAY. Counted like TAB_HIDDEN toward the
-- configured termination threshold.
ALTER TABLE violations
  MODIFY type ENUM(
    'TAB_HIDDEN','WINDOW_BLUR','FULLSCREEN_EXIT','SCREENSHOT_ATTEMPT','COPY_ATTEMPT',
    'PASTE_ATTEMPT','CUT_ATTEMPT','CONTEXT_MENU_ATTEMPT','DEVTOOLS_SHORTCUT','BROWSER_SHORTCUT',
    'SPLIT_SCREEN_SUSPECTED','MULTI_TAB','TEXT_SELECTION','APP_OVERLAY','OTHER'
  ) NOT NULL;

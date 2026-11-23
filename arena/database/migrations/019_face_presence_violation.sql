-- FACE_ABSENT / FACE_CAMERA_OFF: sinyal dari pengawasan kehadiran wajah yang
-- berjalan lokal di perangkat siswa (model cascade kecil, tanpa mengunggah
-- foto/video). Keduanya hanya dicatat untuk ditinjau pengawas dan tidak
-- dihitung menuju terminasi otomatis, karena kamera redup/tertutup bisa
-- menghasilkan false alarm.
ALTER TABLE violations
  MODIFY type ENUM(
    'TAB_HIDDEN','WINDOW_BLUR','FULLSCREEN_EXIT','SCREENSHOT_ATTEMPT','COPY_ATTEMPT',
    'PASTE_ATTEMPT','CUT_ATTEMPT','CONTEXT_MENU_ATTEMPT','DEVTOOLS_SHORTCUT','BROWSER_SHORTCUT',
    'SPLIT_SCREEN_SUSPECTED','MULTI_TAB','TEXT_SELECTION','APP_OVERLAY','FACE_ABSENT',
    'FACE_CAMERA_OFF','OTHER'
  ) NOT NULL;

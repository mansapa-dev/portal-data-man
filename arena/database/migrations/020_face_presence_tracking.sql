-- Face presence tracking: catat status wajah terbaru per peserta agar
-- pengawas dapat memantau siapa yang sedang wajahnya tidak terdeteksi
-- (FACE_ABSENT / FACE_CAMERA_OFF) tanpa notifikasi real-time yang mengganggu.
ALTER TABLE exam_attempts
  ADD COLUMN face_status ENUM('OK','ABSENT','CAMERA_OFF','UNKNOWN') DEFAULT 'UNKNOWN' AFTER violation_count,
  ADD COLUMN face_absence_started_at DATETIME(3) NULL AFTER face_status,
  ADD INDEX idx_arena_attempt_face_status (face_status, face_absence_started_at);

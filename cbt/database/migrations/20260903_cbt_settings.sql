CREATE TABLE IF NOT EXISTS cbt_settings (
  key_name    VARCHAR(100) NOT NULL PRIMARY KEY,
  value       VARCHAR(500) NOT NULL DEFAULT '',
  description VARCHAR(255) NULL,
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO cbt_settings (key_name, value, description) VALUES
  ('remedial_score_cap_X',   '75', 'Nilai maksimum ujian ulang siswa tingkat X (0-100)'),
  ('remedial_score_cap_XI',  '75', 'Nilai maksimum ujian ulang siswa tingkat XI (0-100)'),
  ('remedial_score_cap_XII', '75', 'Nilai maksimum ujian ulang siswa tingkat XII (0-100)')
ON DUPLICATE KEY UPDATE key_name = key_name;

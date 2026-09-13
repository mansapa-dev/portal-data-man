ALTER TABLE students ADD COLUMN IF NOT EXISTS pin_encrypted TEXT NULL AFTER pin_hash;

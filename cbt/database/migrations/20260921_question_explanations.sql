ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation TEXT NULL AFTER points;
ALTER TABLE attempt_questions ADD COLUMN IF NOT EXISTS explanation TEXT NULL AFTER points;

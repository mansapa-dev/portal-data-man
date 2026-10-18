-- Store an encrypted copy of the PIN so authorized staff can reprint cards.
-- pin_hash remains the only credential used for authentication.
SET @add_student_pin_encrypted = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='students' AND column_name='pin_encrypted'),
  'SELECT 1',
  'ALTER TABLE students ADD COLUMN pin_encrypted TEXT NULL AFTER pin_hash'
);
PREPARE arena_pin_stmt FROM @add_student_pin_encrypted;
EXECUTE arena_pin_stmt;
DEALLOCATE PREPARE arena_pin_stmt;

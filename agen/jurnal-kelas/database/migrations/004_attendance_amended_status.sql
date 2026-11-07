-- Allow finalized attendance sessions to be corrected later (AMENDED),
-- mirroring the journal revision flow.  Additive and safe for existing
-- deployments through database/migrate.php.
ALTER TABLE attendance_sessions
  MODIFY status ENUM('DRAFT','FINAL','AMENDED') NOT NULL DEFAULT 'DRAFT';

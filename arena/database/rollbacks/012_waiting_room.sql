-- Manual rollback only after disabling FIFO and backing up these tables.
-- Never run automatically; removes only waiting-room metadata, not attempts/answers.
DROP TABLE exam_waiting_claims;
DROP TABLE exam_waiting_settings;

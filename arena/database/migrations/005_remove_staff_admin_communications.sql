-- Remove the retired staff/admin conversation feature and its stored content.
-- Support tickets remain available as the official channel for exam incidents.
DROP TABLE IF EXISTS staff_admin_messages;
DROP TABLE IF EXISTS staff_admin_threads;

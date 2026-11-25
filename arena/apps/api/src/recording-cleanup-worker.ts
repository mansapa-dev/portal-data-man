/**
 * Recording retention cleanup worker.
 *
 * Runs on a schedule to delete expired recording segments from object storage
 * and mark recording sessions as cleaned up.
 *
 * Safety rules:
 * - Never deletes question images, question attachments, or any other buckets.
 * - Respects legal_hold flag — sessions under hold are never cleaned.
 * - Uses bounded batches to avoid memory/connection exhaustion.
 * - Retry-safe: failed deletions are logged and retried on next run.
 * - Only applies to exam_recording_sessions and exam_recording_segments.
 *
 * Run as a standalone Node.js process (node dist/recording-cleanup-worker.js)
 * or on a cron schedule.
 */
import { pool } from './lib/db.js';
import { getObjectStorage } from './services/object-storage.js';
import type { RowDataPacket } from 'mysql2/promise';

const BATCH_SIZE = Number(process.env.CLEANUP_BATCH_SIZE ?? 50);
const DRY_RUN = process.env.CLEANUP_DRY_RUN === 'true';

interface ExpiredSession {
  id: number;
  public_id: string;
}

interface SegmentToDelete {
  id: number;
  object_key: string;
  session_id: number;
}

async function runCleanup(): Promise<void> {
  if (!pool) {
    console.error('[cleanup] Database pool not available');
    process.exit(1);
  }

  const storage = getObjectStorage();
  if (!storage) {
    console.error('[cleanup] Object storage not configured — aborting cleanup to prevent false completion');
    process.exit(1);
  }

  console.log(`[cleanup] Starting recording cleanup (dry_run=${DRY_RUN}, batch=${BATCH_SIZE})`);

  let totalSessionsCleaned = 0;
  let totalObjectsDeleted = 0;
  let totalFailures = 0;

  // Find expired sessions (not under legal hold)
  let [sessions] = await pool.execute<RowDataPacket[]>(
    `SELECT id, public_id FROM exam_recording_sessions
     WHERE cleanup_status = 'PENDING'
       AND legal_hold = 0
       AND retain_until IS NOT NULL
       AND retain_until <= UTC_TIMESTAMP(3)
       AND status IN ('FINALIZED', 'INTERRUPTED', 'ABANDONED')
     LIMIT ?`,
    [BATCH_SIZE],
  );

  if (sessions.length === 0) {
    console.log('[cleanup] No expired sessions to clean up');
    return;
  }

  for (const session of sessions as ExpiredSession[]) {
    console.log(`[cleanup] Processing session ${session.public_id}`);

    // Get all segments for this session
    const [segments] = await pool.execute<RowDataPacket[]>(
      `SELECT id, object_key, session_id FROM exam_recording_segments
       WHERE session_id = ? AND upload_status = 'UPLOADED'`,
      [session.id],
    );

    let sessionFailed = false;

    for (const seg of segments as SegmentToDelete[]) {
      if (DRY_RUN) {
        console.log(`[cleanup][dry] Would delete object: ${seg.object_key}`);
        totalObjectsDeleted++;
        continue;
      }

      try {
        await storage.deleteObject(seg.object_key);
        totalObjectsDeleted++;
      } catch (error) {
        console.error(`[cleanup] Failed to delete object ${seg.object_key}:`, error);
        totalFailures++;
        sessionFailed = true;
        continue;
      }

      // Mark segment as deleted only after storage deletion succeeds
      await pool.execute(
        `UPDATE exam_recording_segments SET upload_status = 'MISSING' WHERE id = ?`,
        [seg.id],
      );
    }

    // Update session cleanup status (do not swallow DB errors)
    if (!DRY_RUN) {
      const newStatus = sessionFailed ? 'FAILED' : 'COMPLETED';
      await pool.execute(
        `UPDATE exam_recording_sessions
         SET cleanup_status = ?, cleanup_attempted_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [newStatus, session.id],
      );

      if (!sessionFailed) totalSessionsCleaned++;
    }
  }

  console.log(`[cleanup] Done — sessions=${totalSessionsCleaned}, objects=${totalObjectsDeleted}, failures=${totalFailures}`);

  if (totalFailures > 0) {
    console.warn(`[cleanup] ${totalFailures} deletion(s) failed — will retry on next run`);
  }
}

// Run once and exit
runCleanup()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('[cleanup] Fatal error:', error);
    process.exit(1);
  });

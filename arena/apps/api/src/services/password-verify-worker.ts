import { parentPort } from 'node:worker_threads';
import bcrypt from 'bcrypt';

if (!parentPort) throw new Error('Password verification worker requires a parent port');

parentPort.postMessage({ type: 'ready' });
parentPort.on('message', async (job: { id: number; secret: string; encoded: string }) => {
  try {
    const valid = await bcrypt.compare(job.secret, job.encoded);
    parentPort!.postMessage({ type: 'result', id: job.id, valid });
  } catch {
    // Never include the submitted secret or hash in worker errors/logs.
    parentPort!.postMessage({ type: 'result', id: job.id, error: true });
  }
});

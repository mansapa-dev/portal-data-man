import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import bcrypt from 'bcrypt';

if (!parentPort) throw new Error('Password verification worker requires a parent port');

parentPort.postMessage({ type: 'ready' });
parentPort.on('message', async (job: { id: number; secret: string; encoded: string }) => {
  const started = performance.now();
  try {
    if (typeof job.encoded !== 'string' || !job.encoded.startsWith('$2')) {
      parentPort!.postMessage({ type: 'result', id: job.id, valid: false, malformed: true, computeMs: performance.now() - started });
      return;
    }
    const valid = await bcrypt.compare(job.secret, job.encoded);
    parentPort!.postMessage({ type: 'result', id: job.id, valid, computeMs: performance.now() - started });
  } catch {
    // Malformed/unparsable hash treated as non-matching credential internally without disclosing details
    parentPort!.postMessage({ type: 'result', id: job.id, valid: false, malformed: true, computeMs: performance.now() - started });
  }
});

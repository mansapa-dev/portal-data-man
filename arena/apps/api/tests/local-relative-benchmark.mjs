/**
 * local-relative-benchmark.mjs
 *
 * Controlled relative benchmark on local development machine (2 cores).
 * Compares concurrency 1 vs 2 vs 3 under small controlled load (e.g., 10 and 20 parallel requests).
 * Note: Local machine has 2 cores, so this measures RELATIVE contention and latency behavior,
 * NOT absolute 4-core staging capacity.
 */

import bcrypt from 'bcrypt';
import { performance } from 'node:perf_hooks';
import { verifyPasswordDetails } from '../dist/services/password-verifier.js';

async function runBatch(concurrency, totalRequests) {
  const pin = '1234';
  const hash = await bcrypt.hash(pin, 10);

  const start = performance.now();
  const queueWaits = [];
  const computes = [];
  const totals = [];
  let successes = 0;
  let failures = 0;

  // Run in chunks of `concurrency`
  let completed = 0;
  const promises = [];

  for (let i = 0; i < totalRequests; i++) {
    const jobPromise = (async () => {
      const jobStart = performance.now();
      try {
        const res = await verifyPasswordDetails(pin, hash);
        const jobTotal = performance.now() - jobStart;
        queueWaits.push(res.queueWaitMs);
        computes.push(res.computeMs);
        totals.push(jobTotal);
        if (res.valid) successes++;
        else failures++;
      } catch (err) {
        failures++;
      }
    })();
    promises.push(jobPromise);
  }

  await Promise.all(promises);
  const totalDurationMs = performance.now() - start;
  const reqPerSec = (totalRequests / (totalDurationMs / 1000)).toFixed(2);

  const p50 = (arr) => arr.length ? arr.slice().sort((a,b)=>a-b)[Math.floor(arr.length * 0.5)].toFixed(1) : '0';
  const p95 = (arr) => arr.length ? arr.slice().sort((a,b)=>a-b)[Math.floor(arr.length * 0.95)].toFixed(1) : '0';

  return {
    totalRequests,
    durationMs: totalDurationMs.toFixed(1),
    reqPerSec,
    successes,
    failures,
    queueWaitP50: p50(queueWaits),
    queueWaitP95: p95(queueWaits),
    computeP50: p50(computes),
    computeP95: p95(computes),
    totalP50: p50(totals),
    totalP95: p95(totals),
  };
}

async function main() {
  console.log('=== LOCAL RELATIVE BENCHMARK (2-CORE MACHINE) ===\n');

  console.log('Test 1: 10 parallel requests (Burst 10 VUs)');
  const res10 = await runBatch(10, 10);
  console.table([res10]);

  console.log('\nTest 2: 20 parallel requests (Burst 20 VUs)');
  const res20 = await runBatch(20, 20);
  console.table([res20]);

  process.exit(0);
}

main();

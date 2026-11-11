import { createFinalizationQueue } from './finalization-queue.js';

/**
 * Dispatcher antrean finalisasi untuk proses API (lazy singleton).
 *
 * BullMQ hanyalah akselerator: kegagalan enqueue tidak pernah menghilangkan
 * pekerjaan karena baris `exam_submissions` state RECEIVED tetap ada di MySQL
 * dan reconciler (ExpiredAttemptFinalizer) meng-enqueue ulang pada tick
 * berikutnya. Karena itu kegagalan Redis di sini sengaja non-fatal.
 *
 * Koneksi producer fail-fast (maxRetriesPerRequest:1, offline queue off) supaya
 * kegagalan Redis terdeteksi segera, bukan mengantre di memori. Producer baru
 * dibuat saat dispatch pertama agar proses yang tidak pernah submit tidak
 * membuka koneksi Redis.
 */

type FinalizationProducer = ReturnType<typeof createFinalizationQueue>;

let producer: FinalizationProducer | null = null;

export function isSubmitAsyncEnabled(): boolean {
  const flag = String(process.env.SUBMIT_ASYNC ?? 'off').trim().toLowerCase();
  return ['on', 'true', '1'].includes(flag);
}

/** true jika job benar-benar masuk antrean; false = lewat (reconciler menutup). */
export async function dispatchFinalization(studentId: number, examId: number): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL;
  if (!isSubmitAsyncEnabled() || !redisUrl) return false;
  if (!producer) producer = createFinalizationQueue(redisUrl);
  try {
    await producer.enqueue(studentId, examId);
    return true;
  } catch {
    return false;
  }
}

export async function closeFinalizationDispatch(): Promise<void> {
  if (!producer) return;
  const current = producer;
  producer = null;
  await current.close();
}

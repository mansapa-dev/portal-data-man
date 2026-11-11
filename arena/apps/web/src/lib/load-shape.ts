/**
 * Tahap 3 — pemerataan beban.
 *
 * Fungsi murni tanpa DOM/React supaya bisa diuji langsung dengan node:test.
 * Semua jeda diberi batas atas yang aman terhadap timeout server:
 * - claim harus selesai jauh sebelum claim_timeout_ms (60 dtk),
 * - auto-submit tetap dianggap finalisasi setelah expiry,
 * - poll hasil memakai backoff agar tidak menumpuk.
 */
export type Random = () => number;

const between = (min: number, max: number, rng: Random) => min + rng() * (max - min);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/** Jitter claim setelah ADMITTED: 0..min(batch_interval_ms, 8000) ms. */
export function claimDelayMs(batchIntervalMs: number, rng: Random = Math.random): number {
  const cap = clamp(finite(batchIntervalMs), 0, 8_000);
  return Math.floor(between(0, cap, rng));
}

/** Jitter auto-submit saat waktu habis: 0..2000 ms. */
export function submitJitterMs(rng: Random = Math.random): number {
  return Math.floor(between(0, 2_000, rng));
}

/**
 * Backoff poll hasil. submission_state PROCESSING berarti penilaian sudah
 * berjalan dekat selesai, jadi tetap 2 dtk; RECEIVED memakai backoff penuh.
 */
export const RESULT_POLL_BASE_MS = [2_000, 2_000, 3_000, 4_500, 6_000, 8_000, 10_000] as const;

export function resultPollDelayMs(
  attempt: number,
  submissionState?: string | null,
  rng: Random = Math.random,
): number {
  const index = clamp(Math.trunc(finite(attempt)), 0, RESULT_POLL_BASE_MS.length - 1);
  const base = submissionState === 'PROCESSING' ? 2_000 : RESULT_POLL_BASE_MS[index]!;
  return Math.round(base * between(0.75, 1.25, rng));
}

/**
 * Jeda flush autosave: 2,5–5,5 dtk. Phase 0–499 ms stabil per siswa supaya
 * kohort yang mulai bersamaan tidak memilih jendela flush yang sama.
 */
export function autosaveFlushDelayMs(studentId: number, rng: Random = Math.random): number {
  const phase = Math.abs(Math.trunc(finite(studentId))) % 500;
  return Math.round(2_500 + phase + between(0, 2_500, rng));
}

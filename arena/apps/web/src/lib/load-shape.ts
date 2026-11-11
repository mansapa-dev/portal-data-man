/**
 * Tahap 3–4 — pemerataan beban.
 *
 * Fungsi murni tanpa DOM/React supaya bisa diuji langsung dengan node:test.
 * Semua jeda diberi batas atas yang aman terhadap timeout server:
 * - claim harus selesai jauh sebelum claim_timeout_ms (60 dtk),
 * - auto-submit tetap dianggap finalisasi setelah expiry,
 * - poll hasil memakai backoff agar tidak menumpuk,
 * - login disebar sebelum request pertama dan retry memakai backoff.
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

/**
 * Jeda sebelum request login pertama: phase stabil dari digit terakhir NISN
 * (0–2.999 ms) + random 0–2.999 ms. Kohort 1.200 siswa yang menekan Masuk
 * bersamaan menyebar dalam ~6 detik, bukan satu gelombang.
 */
export function loginStartDelayMs(nisn: string, rng: Random = Math.random): number {
  const digits = String(nisn ?? '').replace(/\D/g, '');
  const phase = digits ? Number(digits.slice(-6)) % 3_000 : 0;
  return phase + Math.floor(between(0, 3_000, rng));
}

/**
 * Backoff retry login: full jitter 0..base (base 1, 2, 4, 8, 10 dtk) dengan
 * lantai 500 ms dan menghormati Retry-After server bila lebih panjang.
 */
export function loginRetryDelayMs(attempt: number, retryAfterMs = 0, rng: Random = Math.random): number {
  const step = Math.max(0, Math.trunc(finite(attempt, 1)) - 1);
  const base = Math.min(10_000, 1_000 * 2 ** step);
  const delay = Math.round(between(0, base, rng));
  return Math.max(500, Math.round(finite(retryAfterMs)), delay);
}

/**
 * Pelacak satu episode "keluar layar" (tab tersembunyi, aplikasi kehilangan
 * fokus, atau layar HP mati).
 *
 * Aturan yang dijaga:
 * - Refresh/reload singkat tidak dihitung pelanggaran karena halaman dibatalkan
 *   sebelum ambang tercapai (atau timer dibatalkan oleh pagehide).
 * - Layar mati / pindah aplikasi lebih dari 5 detik dihitung tepat SATU kali
 *   per episode, walaupun timer sempat dibekukan oleh sistem.
 */
export const AWAY_THRESHOLD_MS = 5000;

export type AwayEpisode = {
  /** Mulai episode pada waktu tertentu; idempotent selama episode aktif. */
  start(now: number): void;
  /** True tepat satu kali bila episode sudah melewati ambang. */
  settle(now: number): boolean;
  /** Batalkan episode tanpa mencatat (mis. halaman di-refresh). */
  cancel(): void;
  readonly active: boolean;
  readonly recorded: boolean;
};

export function createAwayEpisode(thresholdMs = AWAY_THRESHOLD_MS): AwayEpisode {
  let since: number | null = null;
  let recorded = false;
  return {
    start(now: number) {
      if (since === null) {
        since = now;
        recorded = false;
      }
    },
    settle(now: number) {
      if (since === null || recorded) return false;
      if (now - since < thresholdMs) return false;
      recorded = true;
      return true;
    },
    cancel() {
      since = null;
      recorded = false;
    },
    get active() {
      return since !== null;
    },
    get recorded() {
      return recorded;
    },
  };
}

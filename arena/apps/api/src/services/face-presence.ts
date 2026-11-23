/** Nilai status wajah yang boleh dikirim siswa. */
export type FacePresenceValue = 'OK' | 'ABSENT' | 'CAMERA_OFF';

export type FacePresenceDecision = {
  /** true bila kolom face_absence_started_at harus diisi waktu server. */
  setStartedAt: boolean;
  /** true bila kolom face_absence_started_at harus dikosongkan (wajah kembali). */
  clearStartedAt: boolean;
};

/**
 * Menentukan perubahan timestamp ketidakhadiran wajah.
 *
 * Aturannya sengaja murni (tanpa DB) supaya bisa diuji dan dipakai di dalam
 * transaksi endpoint face-presence:
 * - `OK` selalu mengosongkan waktu awal;
 * - `ABSENT`/`CAMERA_OFF` pada episode yang sama (status lama sudah
 *   ABSENT/CAMERA_OFF dan timestamp sudah ada) TIDAK boleh mereset waktu awal,
 *   termasuk transisi ABSENT -> CAMERA_OFF dari satu kejadian kamera;
 * - transisi dari OK/UNKNOWN (atau timestamp kosong) mencatat waktu awal baru.
 *
 * Waktu aktual tetap berasal dari UTC_TIMESTAMP(3) MySQL, bukan jam siswa.
 */
export function nextFacePresenceUpdate(
  currentStatus: unknown,
  hasStartedAt: boolean,
  incoming: FacePresenceValue,
): FacePresenceDecision {
  if (incoming === 'OK') return { setStartedAt: false, clearStartedAt: true };
  const wasAbsent = currentStatus === 'ABSENT' || currentStatus === 'CAMERA_OFF';
  if (wasAbsent && hasStartedAt) return { setStartedAt: false, clearStartedAt: false };
  return { setStartedAt: true, clearStartedAt: false };
}

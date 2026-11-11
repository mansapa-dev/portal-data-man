/**
 * Pemulihan sesi saat halaman dimuat.
 *
 * Aplikasi memakai cookie sesi HttpOnly, jadi browser tidak bisa memeriksa
 * cookie dari JavaScript. Kita memakai penanda non-sensitif di localStorage
 * (`arena_active_portal`) sebagai petunjuk: penanda ini ditulis saat login
 * (siswa, pengelola, atau SSO) dan dihapus saat logout.
 *
 * Tanpa petunjuk itu, halaman hanya mencoba satu portal yang dipilih penanda.
 * Pengunjung anonim tidak memicu request session sama sekali, sehingga
 * konsol browser tidak lagi menampilkan 401 yang membingungkan siswa dan
 * petugas. Fallback ke portal lain tetap ada bila penanda usang (mis. sesi
 * siswa kedaluwarsa sementara sesi pengelola masih hidup).
 */
export type RestorePortal = 'student' | 'staff';

export function restorePlan(marker: string | null | undefined): RestorePortal[] {
  if (marker === 'staff') return ['staff', 'student'];
  if (marker === 'student') return ['student', 'staff'];
  return [];
}

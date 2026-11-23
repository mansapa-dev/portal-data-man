export type ApiFaceStatus = 'OK' | 'ABSENT' | 'CAMERA_OFF';

/**
 * Pemetaan status lokal ke status API.
 *
 * `starting` dan `model-error` sengaja TIDAK dipetakan: gangguan model deteksi
 * bukan bukti siswa tidak hadir, jadi tidak boleh menjadi ABSENT/CAMERA_OFF
 * maupun pelanggaran.
 */
const FACE_API_STATUS: Partial<Record<string, ApiFaceStatus>> = {
  ok: 'OK',
  absent: 'ABSENT',
  blocked: 'CAMERA_OFF',
  unavailable: 'CAMERA_OFF',
  error: 'CAMERA_OFF',
};

export function faceApiStatus(status: string): ApiFaceStatus | null {
  return FACE_API_STATUS[status] ?? null;
}

export type FaceTimer = {
  set: (callback: () => void, delay: number) => number;
  clear: (handle: number) => void;
};

export type FaceReporter = {
  /** Laporkan status lokal terbaru; pengiriman digabung & di-retry otomatis. */
  report: (status: string) => void;
  /** Hentikan semua timer & tolak pengiriman berikutnya (saat unmount). */
  dispose: () => void;
};

/**
 * Reporter status wajah dengan jaminan:
 * - yang dicatat sebagai "terkirim" hanya status yang benar-benar di-ACK server;
 * - request gagal boleh mengulang status yang sama dengan jeda bertahap;
 * - tidak ada request paralel;
 * - status terbaru selalu menang (latest-wins), status lama tidak menimpanya.
 */
export function createFaceReporter(opts: {
  send: (status: ApiFaceStatus) => Promise<unknown>;
  timer: FaceTimer;
  delays?: number[];
  random?: () => number;
}): FaceReporter {
  const delays = opts.delays ?? [2000, 5000, 10000, 20000, 30000];
  const random = opts.random ?? Math.random;
  let disposed = false;
  let lastAcked: ApiFaceStatus | null = null;
  let pending: ApiFaceStatus | null = null;
  let inFlight = false;
  let retryStep = 0;
  let handle: number | null = null;

  const cancel = () => {
    if (handle !== null) {
      opts.timer.clear(handle);
      handle = null;
    }
  };

  const schedule = (delay: number) => {
    if (disposed) return;
    cancel();
    handle = opts.timer.set(() => {
      handle = null;
      void flush();
    }, delay);
  };

  const flush = async (): Promise<void> => {
    if (disposed || inFlight) return;
    const target = pending;
    // Tidak ada yang perlu dikirim, atau status terbaru sudah tercatat server.
    if (!target || target === lastAcked) return;
    inFlight = true;
    try {
      await opts.send(target);
      if (disposed) return;
      lastAcked = target;
      retryStep = 0;
    } catch {
      if (disposed) return;
      const delay = delays[Math.min(retryStep, delays.length - 1)] + Math.floor(random() * 500);
      retryStep += 1;
      schedule(delay);
      return;
    } finally {
      inFlight = false;
    }
    // Ada status baru yang masuk saat request berjalan? Kirim sekarang juga.
    if (!disposed && pending !== lastAcked) schedule(0);
  };

  return {
    report: (status: string) => {
      const target = faceApiStatus(status);
      if (!target) return;
      pending = target;
      retryStep = 0;
      if (!inFlight) schedule(0);
    },
    dispose: () => {
      disposed = true;
      cancel();
    },
  };
}

import cascadeUrl from './face/facefinder.bin?url';
import { clusterDetections, runCascade, unpackCascade, type CascadeClassifier, type Detection } from './face/pico';

export type FacePresenceStatus = 'starting' | 'ok' | 'absent' | 'blocked' | 'unavailable' | 'error' | 'model-error';

export type FacePresenceDetail = { faces?: number; missingMs?: number; reason?: string };

export type FacePresenceOptions = {
  onStatus: (status: FacePresenceStatus, detail?: FacePresenceDetail) => void;
  /** Dipanggil sekali per episode saat wajah hilang melewati ambang waktu. */
  onAbsent: (detail: { missingMs: number }) => void;
  /** Dipanggil sekali saat wajah kembali terdeteksi setelah sebelumnya hilang. */
  onRecovered?: () => void;
  /** Dipanggil saat terdeteksi lebih dari satu wajah secara konsisten. */
  onMultipleFaces?: (detail: { faces: number }) => void;
  onCameraProblem?: (reason: 'permission' | 'ended' | 'unsupported' | 'no-camera' | 'error' | 'muted' | 'frozen') => void;
  /** Stream kamera yang sudah dibuka (mis. dari preflight) agar tidak membuka ulang. */
  initialStream?: MediaStream | null;
  /** Berapa lama wajah boleh tidak terlihat sebelum dianggap hilang. */
  absentAfterMs?: number;
  /** Jarak antar sampel. Deteksi berjalan lokal, tidak memanggil server. */
  sampleEveryMs?: number;
  frameWidth?: number;
  frameHeight?: number;
};

export type FacePresenceMonitor = {
  start: () => Promise<void>;
  stop: () => void;
  status: () => FacePresenceStatus;
  getStream: () => MediaStream | null;
};

const DEFAULTS = {
  /** Wajah boleh tidak terlihat selama 5 detik sebelum dianggap hilang (cepat, konsisten aturan 5 detik keluar layar). */
  absentAfterMs: 5_000,
  /** Sampel tiap 1,5 detik agar deteksi hilang/dual wajah responsif tanpa membebani CPU berlebihan. */
  sampleEveryMs: 1_500,
  frameWidth: 160,
  frameHeight: 160,
};

/**
 * Deteksi kehadiran wajah di perangkat siswa.
 *
 * - Kamera hanya dibaca ke canvas kecil di memori; tidak ada foto/video yang
 *   dikirim ke server.
 * - Model cascade dimuat sekali (≈240 KB) dan di-cache browser.
 * - Jika kamera tidak tersedia/izin ditolak, ujian tetap berjalan. Fitur ini
 *   adalah alat bantu pengawasan, bukan penghalang masuk ujian.
 */
export function createFacePresence(options: FacePresenceOptions): FacePresenceMonitor {
  const absentAfterMs = options.absentAfterMs ?? DEFAULTS.absentAfterMs;
  const sampleEveryMs = options.sampleEveryMs ?? DEFAULTS.sampleEveryMs;
  const frameWidth = options.frameWidth ?? DEFAULTS.frameWidth;
  const frameHeight = options.frameHeight ?? DEFAULTS.frameHeight;

  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let classifier: CascadeClassifier | null = null;
  let classifierLoading: Promise<CascadeClassifier | null> | null = null;
  let timer = 0;
  let stopped = false;
  let lastSeenAt = 0;
  let absentReported = false;
  let multipleFacesReported = false;
  let current: FacePresenceStatus = 'starting';

  const setStatus = (status: FacePresenceStatus, detail?: FacePresenceDetail) => {
    current = status;
    options.onStatus(status, detail);
  };

  const loadClassifier = async () => {
    if (classifier) return classifier;
    if (!classifierLoading) {
      classifierLoading = (async () => {
        try {
          const response = await fetch(cascadeUrl, { cache: 'force-cache' });
          if (!response.ok) throw new Error(`cascade ${response.status}`);
          classifier = unpackCascade(new Uint8Array(await response.arrayBuffer()));
          return classifier;
        } catch (error) {
          console.warn('Face cascade gagal dimuat', error);
          return null;
        }
      })();
    }
    return classifierLoading;
  };

  const releaseStream = () => {
    if (stream) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch { /* track sudah berhenti */ }
      }
      stream = null;
    }
    if (video) {
      try {
        video.pause();
        video.srcObject = null;
        video.remove();
      } catch { /* elemen sudah dilepas */ }
      video = null;
    }
    context = null;
  };

  const sample = () => {
    if (stopped || !video || !context || !classifier) return;
    // Saat layar disembunyikan, ketiadaan wajah bukan bukti pelanggaran: siswa
    // sedang keluar layar dan itu sudah ditangani sinyal TAB_HIDDEN. Geser
    // penghitung agar tidak langsung memicu FACE_ABSENT begitu layar kembali.
    if (document.hidden) {
      if (lastSeenAt) lastSeenAt = Date.now();
      return;
    }
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;

    try {
      // Ambil crop persegi dari tengah frame agar wajah tidak terdistorsi saat
      // kamera mengirim gambar portrait (umum di HP).
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      const side = Math.min(sourceWidth, sourceHeight);
      const sx = (sourceWidth - side) / 2;
      const sy = (sourceHeight - side) / 2;
      context.drawImage(video, sx, sy, side, side, 0, 0, frameWidth, frameHeight);
    } catch {
      return;
    }

    let frame: ImageData;
    try {
      frame = context.getImageData(0, 0, frameWidth, frameHeight);
    } catch {
      return;
    }

    const rgba = frame.data;
    const pixels = new Uint8Array(frameWidth * frameHeight);
    let min = 255;
    let max = 0;

    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
      const luma = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
      const value = luma <= 0 ? 0 : luma >= 255 ? 255 : luma | 0;
      pixels[p] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }

    // Peregangan kontras sederhana membantu kamera redup / backlight tanpa
    // menambah model atau beban CPU berarti.
    const span = max - min;
    if (span > 20 && span < 255) {
      const scale = 255 / span;
      for (let p = 0; p < pixels.length; p += 1) {
        pixels[p] = ((pixels[p] - min) * scale) | 0;
      }
    }

    const detections: Detection[] = runCascade(
      { pixels, nrows: frameHeight, ncols: frameWidth, ldim: frameWidth },
      classifier,
      {
        shiftfactor: 0.1,
        minsize: Math.max(18, Math.round(frameHeight * 0.16)),
        maxsize: Math.round(frameHeight * 0.9),
        scalefactor: 1.2,
      },
    );
    const clusters = clusterDetections(detections, 0.2);
    const minFaceSize = Math.max(18, frameHeight * 0.15);
    const faces = clusters.filter(([, , size, score]) => score > 0 && size >= minFaceSize).length;

    const now = Date.now();
    // Frame pertama yang valid baru memulai hitungan grace. Ini mencegah
    // peringatan palsu saat kamera butuh beberapa detik untuk siap.
    if (!lastSeenAt) {
      lastSeenAt = now;
      if (faces > 0 && current !== 'ok') setStatus('ok', { faces });
      return;
    }

    if (faces > 1) {
      // Laporan sekali per episode dual/multi wajah agar tidak membanjir
      // event ke server saat wajah tetap lebih dari satu berturut-turut.
      if (!multipleFacesReported) {
        multipleFacesReported = true;
        options.onMultipleFaces?.({ faces });
      }
    } else {
      multipleFacesReported = false;
    }

    if (faces > 0) {
      lastSeenAt = now;
      if (absentReported) {
        absentReported = false;
        options.onRecovered?.();
      }
      if (current !== 'ok') setStatus('ok', { faces });
      return;
    }

    const missingMs = now - lastSeenAt;
    if (missingMs >= absentAfterMs) {
      if (current !== 'absent') setStatus('absent', { faces: 0, missingMs });
      if (!absentReported) {
        absentReported = true;
        options.onAbsent({ missingMs });
      }
    }
  };

  const schedule = () => {
    if (stopped) return;
    timer = window.setTimeout(() => {
      sample();
      schedule();
    }, sampleEveryMs);
  };

  const onVisibility = () => {
    if (!stopped && !document.hidden) sample();
  };

  const start = async () => {
    if (stopped || stream) return;

    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setStatus('unavailable', { reason: 'unsupported' });
      options.onCameraProblem?.('unsupported');
      return;
    }

    // Jangan memunculkan dialog izin pada perangkat tanpa kamera sama sekali.
    try {
      const devices = await media.enumerateDevices?.();
      if (Array.isArray(devices) && devices.length > 0 && !devices.some((device) => device.kind === 'videoinput')) {
        // Perangkat benar-benar tidak punya kamera: laporkan sebagai masalah
        // kamera (CAMERA_OFF) agar pengawas tahu monitoring tidak berjalan.
        setStatus('unavailable', { reason: 'no-camera' });
        options.onCameraProblem?.('no-camera');
        return;
      }
    } catch { /* enumerateDevices tidak wajib */ }

    setStatus('starting');

    if (options.initialStream && options.initialStream.getVideoTracks().some((t) => t.readyState === 'live')) {
      stream = options.initialStream;
    } else {
      try {
        stream = await media.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 320 },
            height: { ideal: 240 },
            frameRate: { ideal: 10, max: 15 },
          },
        });
      } catch (error) {
        const name = (error as { name?: string }).name ?? '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setStatus('blocked', { reason: 'permission' });
          options.onCameraProblem?.('permission');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setStatus('unavailable', { reason: 'no-camera' });
          options.onCameraProblem?.('no-camera');
        } else if (name === 'NotReadableError' || name === 'AbortError') {
          // Kamera dipakai proses lain / perangkat gagal membuka stream.
          setStatus('error', { reason: name });
          options.onCameraProblem?.('error');
        } else {
          setStatus('error', { reason: name || 'error' });
          options.onCameraProblem?.('error');
        }
        return;
      }
    }

    if (stopped) {
      releaseStream();
      return;
    }

    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute('aria-hidden', 'true');
    video.style.position = 'fixed';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      /* muted autoplay umumnya diizinkan; sampel akan gagal sampai video siap */
    }

    const canvas = document.createElement('canvas');
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      // Canvas tidak tersedia: pipeline kamera tidak bisa berjalan.
      setStatus('error', { reason: 'canvas' });
      options.onCameraProblem?.('error');
      releaseStream();
      return;
    }

    const track = stream.getVideoTracks()[0];
    track?.addEventListener('ended', () => {
      if (stopped) return;
      setStatus('error', { reason: 'ended' });
      options.onCameraProblem?.('ended');
    });
    track?.addEventListener('mute', () => {
      if (stopped) return;
      setStatus('error', { reason: 'muted' });
      options.onCameraProblem?.('muted');
    });
    track?.addEventListener('unmute', () => {
      if (stopped) return;
      setStatus('ok');
      options.onRecovered?.();
    });

    lastSeenAt = 0;
    absentReported = false;

    const ready = await loadClassifier();
    if (stopped) return;
    if (!ready) {
      // Kamera hidup tetapi model deteksi gagal dimuat. Ini gangguan teknis,
      // BUKAN bukti siswa tidak hadir: bedakan statusnya (model-error) agar
      // frontend tidak mengirim ABSENT/CAMERA_OFF maupun mencatat pelanggaran.
      setStatus('model-error', { reason: 'model' });
      releaseStream();
      return;
    }

    document.addEventListener('visibilitychange', onVisibility);
    schedule();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
    document.removeEventListener('visibilitychange', onVisibility);
    releaseStream();
    absentReported = false;
    multipleFacesReported = false;
  };

  return { start, stop, status: () => current, getStream: () => stream };
}

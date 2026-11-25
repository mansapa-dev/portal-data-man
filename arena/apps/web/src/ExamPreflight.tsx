/**
 * ExamPreflight — Universal device pre-flight check component.
 *
 * Runs before an exam starts to verify:
 * 1. Camera availability and permission
 * 2. Recording capability
 * 3. Browser compatibility
 * 4. Network connectivity
 * 5. Student acknowledgment of monitoring rules
 *
 * Mobile-first design supporting 320px–desktop widths.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { detectCapabilities } from './lib/device-capability';

type CheckStatus = 'pending' | 'checking' | 'pass' | 'fail' | 'warning' | 'skipped';

interface CheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  message?: string;
  required: boolean;
}

export interface PreflightResult {
  passed: boolean;
  cameraStream: MediaStream | null;
  recordingMimeType: string | null;
  deviceInfo: ReturnType<typeof detectCapabilities>;
}

export interface ExamPreflightProps {
  examName: string;
  requireCamera: boolean;
  requireRecording: boolean;
  onReady: (result: PreflightResult) => void;
  onCancel: () => void;
}

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === 'pending') return <i className="fa-regular fa-circle preflight-icon preflight-icon--pending" aria-hidden="true" />;
  if (status === 'checking') return <i className="fa-solid fa-spinner fa-spin preflight-icon preflight-icon--checking" aria-hidden="true" />;
  if (status === 'pass') return <i className="fa-solid fa-circle-check preflight-icon preflight-icon--pass" aria-hidden="true" />;
  if (status === 'fail') return <i className="fa-solid fa-circle-xmark preflight-icon preflight-icon--fail" aria-hidden="true" />;
  if (status === 'warning') return <i className="fa-solid fa-triangle-exclamation preflight-icon preflight-icon--warning" aria-hidden="true" />;
  return <i className="fa-solid fa-circle-minus preflight-icon preflight-icon--skipped" aria-hidden="true" />;
}

export function ExamPreflight({ examName, requireCamera, requireRecording, onReady, onCancel }: ExamPreflightProps) {
  const [checks, setChecks] = useState<CheckItem[]>([
    { id: 'secure', label: 'Koneksi aman', status: 'pending', required: true },
    { id: 'camera_perm', label: 'Izin kamera', status: 'pending', required: requireCamera },
    { id: 'camera_device', label: 'Perangkat kamera', status: 'pending', required: requireCamera },
    { id: 'camera_stream', label: 'Aliran video kamera', status: 'pending', required: requireCamera },
    { id: 'recording', label: 'Kemampuan merekam', status: 'pending', required: requireRecording },
    { id: 'network', label: 'Koneksi internet', status: 'pending', required: true },
  ]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [runningChecks, setRunningChecks] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [recordingMimeType, setRecordingMimeType] = useState<string | null>(null);
  const [preflightDone, setPreflightDone] = useState(false);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handedOffRef = useRef(false);

  const stopStream = useCallback((s: MediaStream | null) => {
    if (!s) return;
    for (const track of s.getTracks()) {
      try { track.stop(); } catch { /* already stopped */ }
    }
  }, []);

  const updateCheck = useCallback((id: string, update: Partial<CheckItem>) => {
    setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, ...update } : c)));
  }, []);

  const runChecks = useCallback(async () => {
    setRunningChecks(true);
    setPreflightDone(false);
    handedOffRef.current = false;
    if (streamRef.current) {
      stopStream(streamRef.current);
      streamRef.current = null;
      setCameraStream(null);
    }

    const caps = detectCapabilities();

    // 1. Secure context
    updateCheck('secure', { status: 'checking' });
    await new Promise((r) => setTimeout(r, 300));
    if (!caps.secureContext) {
      updateCheck('secure', { status: 'fail', message: 'Halaman harus dibuka melalui HTTPS' });
      setRunningChecks(false);
      return;
    }
    updateCheck('secure', { status: 'pass' });

    // 2. Camera permission + device
    if (requireCamera) {
      updateCheck('camera_perm', { status: 'checking' });
      updateCheck('camera_device', { status: 'checking' });
      updateCheck('camera_stream', { status: 'checking' });

      if (!caps.getUserMedia) {
        updateCheck('camera_perm', { status: 'fail', message: 'Browser tidak mendukung akses kamera' });
        updateCheck('camera_device', { status: 'skipped' });
        updateCheck('camera_stream', { status: 'skipped' });
      } else {
        // Check for video devices first
        let hasVideoDevice = false;
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          hasVideoDevice = devices.some((d) => d.kind === 'videoinput');
        } catch { hasVideoDevice = true; } // Assume present if can't check

        if (!hasVideoDevice) {
          updateCheck('camera_perm', { status: 'skipped' });
          updateCheck('camera_device', { status: 'fail', message: 'Tidak ditemukan kamera pada perangkat ini' });
          updateCheck('camera_stream', { status: 'skipped' });
        } else {
          updateCheck('camera_device', { status: 'pass' });

          // Request camera permission
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                facingMode: 'user',
                width: { ideal: 640, max: 1280 },
                height: { ideal: 480, max: 720 },
                frameRate: { ideal: 15, max: 30 },
              },
            });

            updateCheck('camera_perm', { status: 'pass' });

            // Verify active video track
            const videoTrack = stream.getVideoTracks()[0];
            if (!videoTrack || videoTrack.readyState !== 'live') {
              updateCheck('camera_stream', { status: 'fail', message: 'Aliran video kamera tidak aktif' });
              stream.getTracks().forEach((t) => t.stop());
            } else {
              updateCheck('camera_stream', { status: 'pass' });
              streamRef.current = stream;
              setCameraStream(stream);

              videoTrack.addEventListener('ended', () => {
                updateCheck('camera_stream', { status: 'fail', message: 'Aliran kamera terputus. Periksa kamera dan coba ulang.' });
                setCameraStream(null);
                streamRef.current = null;
              });

              // Connect preview
              if (videoPreviewRef.current) {
                videoPreviewRef.current.srcObject = stream;
                void videoPreviewRef.current.play().catch(() => {});
              }
            }
          } catch (error) {
            const name = (error as { name?: string }).name ?? '';
            if (name === 'NotAllowedError' || name === 'SecurityError') {
              updateCheck('camera_perm', { status: 'fail', message: 'Izin kamera ditolak. Aktifkan izin kamera di pengaturan browser.' });
            } else if (name === 'NotFoundError') {
              updateCheck('camera_perm', { status: 'pass' });
              updateCheck('camera_device', { status: 'fail', message: 'Kamera tidak ditemukan' });
            } else if (name === 'NotReadableError') {
              updateCheck('camera_perm', { status: 'pass' });
              updateCheck('camera_device', { status: 'fail', message: 'Kamera sedang digunakan aplikasi lain' });
            } else {
              updateCheck('camera_perm', { status: 'fail', message: `Gagal mengakses kamera: ${name || 'kesalahan tidak diketahui'}` });
            }
            updateCheck('camera_stream', { status: 'skipped' });
          }
        }
      }
    } else {
      updateCheck('camera_perm', { status: 'skipped' });
      updateCheck('camera_device', { status: 'skipped' });
      updateCheck('camera_stream', { status: 'skipped' });
    }

    // 3. Recording capability
    if (requireRecording) {
      updateCheck('recording', { status: 'checking' });
      await new Promise((r) => setTimeout(r, 200));

      if (!caps.mediaRecorder) {
        updateCheck('recording', { status: 'fail', message: 'Browser tidak mendukung perekaman video. Gunakan Chrome, Edge, Firefox, atau Samsung Internet versi terbaru.' });
      } else if (!caps.bestRecordingMimeType) {
        updateCheck('recording', { status: 'fail', message: 'Tidak ada format rekaman yang didukung browser ini. Perbarui browser Anda.' });
      } else if (!caps.indexedDB) {
        updateCheck('recording', { status: 'fail', message: 'Penyimpanan sementara browser (IndexedDB) tidak tersedia. Nonaktifkan mode privat/penyamaran atau ganti browser.' });
      } else if (!streamRef.current) {
        updateCheck('recording', { status: 'fail', message: 'Kamera harus aktif sebelum perekaman dapat disiapkan.' });
      } else {
        try {
          const probe = new MediaRecorder(streamRef.current, { mimeType: caps.bestRecordingMimeType });
          probe.start();
          if (probe.state !== 'recording') {
            throw new Error('MediaRecorder failed to enter recording state');
          }
          probe.stop();
          setRecordingMimeType(caps.bestRecordingMimeType);
          updateCheck('recording', { status: 'pass', message: `Format siap: ${caps.bestRecordingMimeType}` });
        } catch {
          setRecordingMimeType(null);
          updateCheck('recording', { status: 'fail', message: 'Browser gagal memulai perekaman video dari kamera. Gunakan Chrome, Edge, atau Firefox terbaru.' });
        }
      }
    } else {
      updateCheck('recording', { status: 'skipped' });
    }

    // 4. Network
    updateCheck('network', { status: 'checking' });
    try {
      const response = await fetch('/health', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        updateCheck('network', { status: 'pass' });
      } else {
        updateCheck('network', { status: 'warning', message: 'Koneksi tidak stabil. Ujian tetap dapat dimulai.' });
      }
    } catch {
      updateCheck('network', { status: 'warning', message: 'Tidak dapat memverifikasi koneksi. Pastikan internet aktif.' });
    }

    setRunningChecks(false);
    setPreflightDone(true);
  }, [requireCamera, requireRecording, stopStream, updateCheck]);

  useEffect(() => {
    void runChecks();
    return () => {
      if (!handedOffRef.current && streamRef.current) {
        stopStream(streamRef.current);
        streamRef.current = null;
      }
    };
  }, [runChecks, stopStream]);

  const allRequiredPassed = checks.every((c) => !c.required || c.status === 'pass' || c.status === 'warning');
  const anyRequiredFailed = checks.some((c) => c.required && c.status === 'fail');

  const handleStart = () => {
    const caps = detectCapabilities();
    const activeStream = streamRef.current;
    if (requireCamera) {
      const liveTrack = activeStream?.getVideoTracks().find((t) => t.readyState === 'live');
      if (!activeStream || !liveTrack) {
        updateCheck('camera_stream', { status: 'fail', message: 'Kamera tidak aktif. Klik Coba ulang untuk menyambungkan kamera.' });
        return;
      }
    }
    if (requireRecording && (!recordingMimeType || !caps.indexedDB)) {
      updateCheck('recording', { status: 'fail', message: 'Persiapan perekaman belum memenuhi syarat.' });
      return;
    }
    handedOffRef.current = true;
    onReady({
      passed: true,
      cameraStream: activeStream,
      recordingMimeType,
      deviceInfo: caps,
    });
  };

  return (
    <div className="preflight-container" role="main" aria-label="Pemeriksaan awal ujian">
      <div className="preflight-header">
        <h1 className="preflight-title">
          <i className="fa-solid fa-shield-halved" aria-hidden="true" /> Pemeriksaan Awal Ujian
        </h1>
        <p className="preflight-exam-name">{examName}</p>
      </div>

      {/* Camera preview */}
      {requireCamera && cameraStream && (
        <div className="preflight-camera-preview">
          <video
            ref={videoPreviewRef}
            autoPlay
            muted
            playsInline
            aria-label="Pratinjau kamera"
            className="preflight-video"
          />
          <span className="preflight-camera-label">
            <i className="fa-solid fa-video" aria-hidden="true" /> Kamera aktif
          </span>
        </div>
      )}

      {/* Checks list */}
      <div className="preflight-checks" role="list" aria-label="Daftar pemeriksaan">
        {checks.map((check) => (
          <div key={check.id} className={`preflight-check preflight-check--${check.status}`} role="listitem">
            <StatusIcon status={check.status} />
            <div className="preflight-check-content">
              <span className="preflight-check-label">{check.label}</span>
              {check.message && <span className="preflight-check-message">{check.message}</span>}
            </div>
            {check.required && <span className="preflight-required-badge" aria-label="Wajib">Wajib</span>}
          </div>
        ))}
      </div>

      {/* Disclosure notice */}
      {preflightDone && !anyRequiredFailed && (
        <div className="preflight-disclosure">
          <h2 className="preflight-disclosure-title">Ketentuan Pengawasan</h2>
          <ul className="preflight-disclosure-list">
            <li>Kamera Anda akan aktif selama ujian berlangsung.</li>
            {requireRecording && <li>Video kamera akan direkam dan disimpan sebagai bukti ujian (tidak ada audio).</li>}
            <li>Rekaman hanya dapat diakses oleh pengawas yang berwenang.</li>
            <li>Rekaman akan dihapus sesuai kebijakan retensi institusi.</li>
            <li>Berpindah aplikasi, menyembunyikan layar, atau menutup browser akan dicatat sebagai kejadian pengawasan.</li>
            <li>Keputusan disiplin memerlukan kajian manusia — sinyal otomatis bukan bukti pelanggaran.</li>
          </ul>
          <label className="preflight-ack-label">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="preflight-ack-checkbox"
            />
            <span>Saya memahami dan menyetujui ketentuan pengawasan di atas.</span>
          </label>
        </div>
      )}

      {/* Actions */}
      <div className="preflight-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            if (streamRef.current) {
              stopStream(streamRef.current);
              streamRef.current = null;
              setCameraStream(null);
            }
            onCancel();
          }}
          disabled={runningChecks}
        >
          Batal
        </button>
        {anyRequiredFailed ? (
          <button type="button" className="btn btn-secondary" onClick={() => void runChecks()} disabled={runningChecks}>
            {runningChecks ? 'Memeriksa…' : 'Coba ulang'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!preflightDone || !allRequiredPassed || !acknowledged || runningChecks}
            onClick={handleStart}
          >
            {runningChecks ? 'Memeriksa…' : 'Mulai Ujian'}
          </button>
        )}
      </div>
    </div>
  );
}

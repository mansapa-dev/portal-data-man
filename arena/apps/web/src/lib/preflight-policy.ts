/**
 * Pure policy evaluation for exam preflight and recording enforcement.
 *
 * Fail-closed rules:
 * - Missing or failed policy fetch blocks exam entry.
 * - If recording_required is true, recording_enabled AND storage_available must
 *   both be true; otherwise exam entry is blocked with a clear Indonesian error.
 * - Camera preflight is ALWAYS required regardless of recording_enabled.
 */

export interface ServerRecordingPolicy {
  recording_enabled: boolean;
  recording_required: boolean;
  storage_available?: boolean;
  segment_duration_seconds: number;
  video_bitrate: number;
  retention_days?: number;
}

export interface PolicyEvaluation {
  allowed: boolean;
  requireCamera: boolean;
  requireRecording: boolean;
  recordingActive: boolean;
  errorMessage?: string;
}

export function evaluateRecordingPolicy(policy: ServerRecordingPolicy | null | undefined): PolicyEvaluation {
  if (!policy) {
    return {
      allowed: false,
      requireCamera: true,
      requireRecording: true,
      recordingActive: false,
      errorMessage: 'Gagal memeriksa kebijakan pengawasan ujian. Periksa koneksi internet dan coba lagi.',
    };
  }

  const storageAvailable = policy.storage_available !== false;

  if (policy.recording_required) {
    if (!policy.recording_enabled) {
      return {
        allowed: false,
        requireCamera: true,
        requireRecording: true,
        recordingActive: false,
        errorMessage: 'Perekaman video wajib untuk ujian ini, tetapi layanan perekaman belum aktif. Hubungi pengawas.',
      };
    }
    if (!storageAvailable) {
      return {
        allowed: false,
        requireCamera: true,
        requireRecording: true,
        recordingActive: false,
        errorMessage: 'Penyimpanan rekaman ujian tidak tersedia saat ini. Hubungi pengawas.',
      };
    }
    return {
      allowed: true,
      requireCamera: true,
      requireRecording: true,
      recordingActive: true,
    };
  }

  // Recording is optional
  const canRecordOptional = Boolean(policy.recording_enabled && storageAvailable);
  return {
    allowed: true,
    requireCamera: true,
    requireRecording: false,
    recordingActive: canRecordOptional,
  };
}

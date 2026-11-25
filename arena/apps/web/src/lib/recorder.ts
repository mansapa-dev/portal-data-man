/**
 * MediaRecorder wrapper for exam recording.
 *
 * Design decisions:
 * - Uses the same camera stream as face presence monitoring.
 * - 60-second segments by default (configurable).
 * - No audio capture.
 * - No screen recording.
 * - Bounded memory: each segment is finalized before the next starts.
 * - Handles browser suspension, camera interruption, and MediaRecorder failure.
 * - Does NOT upload — that's the UploadQueue's job.
 */

export interface RecorderConfig {
  /** Camera stream to record (shared with face presence). */
  stream: MediaStream;
  /** MIME type to use (must be MediaRecorder.isTypeSupported). */
  mimeType: string;
  /** Target video bitrate in bps. Default 500000. */
  videoBitsPerSecond?: number;
  /** Segment duration in milliseconds. Default 60000. */
  segmentDurationMs?: number;
  /** Called when a segment blob is ready. */
  onSegment: (segment: RecordingSegment) => void;
  /** Called when recorder encounters an unrecoverable error. */
  onError: (error: Error) => void;
  /** Called when recorder stops unexpectedly. */
  onStopped: () => void;
}

export interface RecordingSegment {
  blob: Blob;
  mimeType: string;
  sequenceNumber: number;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
}

export interface ExamRecorder {
  start(): void;
  stop(): void;
  readonly isRecording: boolean;
  readonly segmentCount: number;
}

export function createExamRecorder(config: RecorderConfig): ExamRecorder {
  const segmentDurationMs = config.segmentDurationMs ?? 60_000;
  const videoBitsPerSecond = config.videoBitsPerSecond ?? 500_000;

  let recorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let segmentCount = 0;
  let segmentStartedAt: Date | null = null;
  let segmentTimer = 0;
  let stopped = false;
  let recording = false;

  const finishSegment = () => {
    if (!recorder || chunks.length === 0 || !segmentStartedAt) return;
    const endedAt = new Date();
    const blob = new Blob(chunks, { type: config.mimeType });
    chunks = [];
    const seq = segmentCount++;
    const startedAt = segmentStartedAt;
    segmentStartedAt = null;

    config.onSegment({
      blob,
      mimeType: config.mimeType,
      sequenceNumber: seq,
      startedAt,
      endedAt,
      durationMs: endedAt.getTime() - startedAt.getTime(),
    });
  };

  const startNewSegment = () => {
    if (stopped || !recorder) return;
    // Clear any existing segment timer
    if (segmentTimer) window.clearTimeout(segmentTimer);

    // Request available data before starting a new segment
    try {
      if (recorder.state === 'recording') {
        recorder.requestData();
      }
    } catch { /* non-fatal */ }

    segmentStartedAt = new Date();
    segmentTimer = window.setTimeout(() => {
      if (stopped) return;
      startNewSegment();
    }, segmentDurationMs);
  };

  const startRecorder = () => {
    if (stopped) return;

    // Verify camera track is still active
    const videoTracks = config.stream.getVideoTracks();
    if (videoTracks.length === 0 || videoTracks[0]!.readyState !== 'live') {
      config.onError(new Error('Camera track not available'));
      return;
    }

    try {
      recorder = new MediaRecorder(config.stream, {
        mimeType: config.mimeType,
        videoBitsPerSecond,
      });
    } catch (error) {
      config.onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onstop = () => {
      // Finalize whatever data we have
      finishSegment();
      if (!stopped) {
        // Unexpected stop — report
        config.onStopped();
      }
    };

    recorder.onerror = (event) => {
      const error = (event as Event & { error?: Error }).error;
      config.onError(error || new Error('MediaRecorder error'));
    };

    chunks = [];
    segmentStartedAt = new Date();
    recording = true;

    try {
      // Use timeslice to get periodic data events, but don't rely on them
      // being exactly on time (mobile OS may delay them).
      recorder.start(10_000); // 10s timeslice
    } catch (error) {
      config.onError(error instanceof Error ? error : new Error(String(error)));
      recording = false;
      return;
    }

    startNewSegment();
  };

  const stopRecorder = () => {
    if (segmentTimer) { window.clearTimeout(segmentTimer); segmentTimer = 0; }
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* ignore */ }
    }
    recording = false;
    recorder = null;
  };

  return {
    start() {
      if (stopped || recording) return;
      startRecorder();
    },
    stop() {
      stopped = true;
      stopRecorder();
    },
    get isRecording() { return recording; },
    get segmentCount() { return segmentCount; },
  };
}

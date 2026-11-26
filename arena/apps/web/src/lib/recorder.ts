/**
 * MediaRecorder wrapper for exam recording.
 *
 * Design decisions:
 * - Uses the same camera stream as face presence monitoring.
 * - 60-second segments by default (configurable).
 * - No audio capture, no screen recording.
 * - Every segment is a COMPLETE, standalone WebM/MP4 file. MediaRecorder is
 *   stopped and restarted at each boundary instead of slicing the byte stream
 *   with requestData(): only the first blob of a MediaRecorder session carries
 *   the container header, so later requestData() blobs cannot be played on
 *   their own (the browser reports "No video with supported format and MIME
 *   type found").
 * - Bounded memory: each segment is finalized before the next starts.
 * - Detects camera track termination, MediaRecorder errors, and visibility suspension.
 * - Supports deterministic stopAndFlush() so final segment is never lost on submit.
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
  stopAndFlush(): Promise<RecordingSegment | null>;
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
  let rotating = false;
  let flushResolve: ((seg: RecordingSegment | null) => void) | null = null;
  let watchedTrack: MediaStreamTrack | null = null;

  const finishSegment = (): RecordingSegment | null => {
    if (chunks.length === 0 || !segmentStartedAt) return null;
    const endedAt = new Date();
    const blob = new Blob(chunks, { type: config.mimeType });
    chunks = [];
    const seq = segmentCount++;
    const startedAt = segmentStartedAt;
    segmentStartedAt = null;

    const segment: RecordingSegment = {
      blob,
      mimeType: config.mimeType,
      sequenceNumber: seq,
      startedAt,
      endedAt,
      durationMs: endedAt.getTime() - startedAt.getTime(),
    };
    config.onSegment(segment);
    return segment;
  };

  const cleanupListeners = () => {
    if (watchedTrack) {
      watchedTrack.removeEventListener('ended', onTrackEnded);
      watchedTrack = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };

  const onTrackEnded = () => {
    if (stopped) return;
    // Mark fully stopped first so onstop() does not rotate into a new recorder
    // on a camera that has just disappeared.
    stopped = true;
    rotating = false;
    recording = false;
    if (segmentTimer) { window.clearTimeout(segmentTimer); segmentTimer = 0; }
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* onstop may not fire */ }
    }
    cleanupListeners();
    config.onError(new Error('Camera track ended during recording'));
  };

  const onVisibilityChange = () => {
    if (stopped || document.hidden) return;
    const track = config.stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') {
      onTrackEnded();
      return;
    }
    if (recording && recorder && recorder.state === 'inactive') {
      recording = false;
      config.onStopped();
    }
  };

  const startRecorder = () => {
    if (stopped || (recorder && recorder.state !== 'inactive')) return;

    const videoTracks = config.stream.getVideoTracks();
    const track = videoTracks[0];
    if (!track || track.readyState !== 'live') {
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

    watchedTrack = track;
    track.addEventListener('ended', onTrackEnded);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onstop = () => {
      recording = false;
      let finalSegment: RecordingSegment | null = null;
      try {
        finalSegment = finishSegment();
      } catch (error) {
        config.onError(error instanceof Error ? error : new Error(String(error)));
      }
      cleanupListeners();
      if (flushResolve) {
        const resolve = flushResolve;
        flushResolve = null;
        resolve(finalSegment);
        return;
      }
      if (!stopped && rotating) {
        rotating = false;
        // Starting a brand-new MediaRecorder guarantees the next segment has its
        // own container header and can be played independently. Defer one tick
        // so browsers (notably Android Chrome) finish tearing down the previous
        // recorder before a new one is constructed on the same camera track.
        window.setTimeout(() => {
          if (!stopped) startRecorder();
        }, 0);
        return;
      }
      if (!stopped) {
        config.onStopped();
      }
    };

    recorder.onerror = (event) => {
      recording = false;
      const error = (event as Event & { error?: Error }).error;
      config.onError(error || new Error('MediaRecorder error'));
    };

    chunks = [];
    segmentStartedAt = new Date();
    recording = true;

    try {
      recorder.start();
    } catch (error) {
      recording = false;
      cleanupListeners();
      config.onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    segmentTimer = window.setTimeout(() => {
      if (stopped) return;
      rotateSegment();
    }, segmentDurationMs);
  };

  const rotateSegment = () => {
    if (stopped || !recorder || recorder.state !== 'recording') return;
    if (segmentTimer) { window.clearTimeout(segmentTimer); segmentTimer = 0; }
    rotating = true;
    try {
      // stop() flushes the final chunk and fires onstop(), where the complete
      // segment is finalized and the next recorder is started.
      recorder.stop();
    } catch {
      rotating = false;
      recording = false;
      cleanupListeners();
      if (!stopped) startRecorder();
    }
  };

  const stopRecorder = () => {
    if (segmentTimer) { window.clearTimeout(segmentTimer); segmentTimer = 0; }
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        recording = false;
        cleanupListeners();
      }
    } else {
      recording = false;
      cleanupListeners();
    }
  };

  return {
    start() {
      if (stopped || recording) return;
      startRecorder();
    },
    stop() {
      stopped = true;
      rotating = false;
      stopRecorder();
      recorder = null;
    },
    async stopAndFlush(): Promise<RecordingSegment | null> {
      stopped = true;
      rotating = false;
      if (segmentTimer) { window.clearTimeout(segmentTimer); segmentTimer = 0; }
      if (!recorder || recorder.state === 'inactive') {
        recording = false;
        cleanupListeners();
        return finishSegment();
      }
      return new Promise<RecordingSegment | null>((resolve) => {
        const fallback = window.setTimeout(() => {
          if (flushResolve) {
            flushResolve = null;
            resolve(finishSegment());
          }
        }, 2500);
        flushResolve = (seg) => {
          window.clearTimeout(fallback);
          resolve(seg);
        };
        try {
          recorder!.stop();
        } catch {
          window.clearTimeout(fallback);
          flushResolve = null;
          resolve(finishSegment());
        }
      });
    },
    get isRecording() { return recording; },
    get segmentCount() { return segmentCount; },
  };
}

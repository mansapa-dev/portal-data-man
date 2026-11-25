/**
 * Runtime browser/device capability detection.
 *
 * Uses feature detection, NOT user-agent sniffing.
 * Results are cached after first check.
 *
 * Purpose: determine what security features the current browser supports
 * before allowing exam entry. This is used in the preflight check.
 */

export type DeviceCategory = 'mobile' | 'tablet' | 'desktop' | 'unknown';

export interface BrowserCapabilities {
  /** Camera API available */
  getUserMedia: boolean;
  /** Can enumerate devices (may need permission first) */
  enumerateDevices: boolean;
  /** MediaRecorder API available */
  mediaRecorder: boolean;
  /** Best supported recording MIME type, or null if none */
  bestRecordingMimeType: string | null;
  /** Supported recording MIME types */
  supportedMimeTypes: string[];
  /** Fullscreen API available */
  fullscreen: boolean;
  /** Page Visibility API available */
  pageVisibility: boolean;
  /** Network Information API available */
  networkInformation: boolean;
  /** Wake Lock API available */
  wakeLock: boolean;
  /** BroadcastChannel available (multi-tab detection) */
  broadcastChannel: boolean;
  /** IndexedDB available */
  indexedDB: boolean;
  /** Secure context (required for camera/recording) */
  secureContext: boolean;
  /** Device category based on screen and touch heuristics */
  deviceCategory: DeviceCategory;
  /** Estimated device pixel ratio */
  devicePixelRatio: number;
  /** Screen dimensions */
  screenWidth: number;
  screenHeight: number;
  /** Touch support */
  touchSupport: boolean;
  /** Detected OS family (heuristic only, for compatibility reporting) */
  osFamilyHint: string;
  /** Detected browser family (heuristic only, for compatibility reporting) */
  browserFamilyHint: string;
}

/** Candidate recording MIME types in preference order. */
const RECORDING_MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm;codecs=h264',
  'video/webm;codecs=av1',
  'video/webm',
  'video/mp4;codecs=h264',
  'video/mp4',
  'video/ogg',
];

/** Find the best available recording MIME type for this browser. */
export function detectBestMimeType(): { best: string | null; supported: string[] } {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return { best: null, supported: [] };
  }
  const supported = RECORDING_MIME_CANDIDATES.filter((type) => {
    try { return MediaRecorder.isTypeSupported(type); } catch { return false; }
  });
  return { best: supported[0] ?? null, supported };
}

/** Classify device category from screen/touch heuristics. */
function classifyDevice(): DeviceCategory {
  if (typeof window === 'undefined') return 'unknown';
  const width = screen.width;
  const height = screen.height;
  const maxDim = Math.max(width, height);
  const minDim = Math.min(width, height);
  const touch = navigator.maxTouchPoints > 0;

  if (!touch) return 'desktop';
  if (minDim >= 600 && maxDim >= 900) return 'tablet';
  return 'mobile';
}

/** Extract OS family hint from UA string (heuristic — not authoritative). */
function detectOsHint(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

/** Extract browser family hint from UA string (heuristic — not authoritative). */
function detectBrowserHint(): string {
  const ua = navigator.userAgent;
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'Unknown';
}

let _cached: BrowserCapabilities | null = null;

/** Detect browser capabilities. Results are cached after first call. */
export function detectCapabilities(): BrowserCapabilities {
  if (_cached) return _cached;

  const { best, supported } = detectBestMimeType();

  _cached = {
    getUserMedia: !!(navigator.mediaDevices?.getUserMedia),
    enumerateDevices: !!(navigator.mediaDevices?.enumerateDevices),
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    bestRecordingMimeType: best,
    supportedMimeTypes: supported,
    fullscreen: !!(document.documentElement.requestFullscreen || (document.documentElement as Element & { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen),
    pageVisibility: typeof document.hidden !== 'undefined',
    networkInformation: 'connection' in navigator || 'mozConnection' in navigator,
    wakeLock: 'wakeLock' in navigator,
    broadcastChannel: typeof BroadcastChannel !== 'undefined',
    indexedDB: typeof indexedDB !== 'undefined',
    secureContext: window.isSecureContext === true,
    deviceCategory: classifyDevice(),
    devicePixelRatio: window.devicePixelRatio || 1,
    screenWidth: screen.width,
    screenHeight: screen.height,
    touchSupport: navigator.maxTouchPoints > 0,
    osFamilyHint: detectOsHint(),
    browserFamilyHint: detectBrowserHint(),
  };

  return _cached;
}

/** Serializable summary for API reporting. */
export function capabilitiesToApiPayload(caps: BrowserCapabilities) {
  return {
    device_category: caps.deviceCategory === 'mobile' ? 'MOBILE'
      : caps.deviceCategory === 'tablet' ? 'TABLET'
      : caps.deviceCategory === 'desktop' ? 'DESKTOP' : 'UNKNOWN',
    browser_family: caps.browserFamilyHint,
    os_family: caps.osFamilyHint,
    screen_width: caps.screenWidth,
    screen_height: caps.screenHeight,
    camera_available: caps.getUserMedia,
    recording_capable: caps.mediaRecorder && caps.bestRecordingMimeType !== null,
    recording_mime_type: caps.bestRecordingMimeType,
    fullscreen_capable: caps.fullscreen,
    wake_lock_capable: caps.wakeLock,
    network_type: (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType ?? null,
  };
}

/**
 * Server-side risk scoring engine for exam integrity events.
 *
 * Weights are configurable. Scores are computed on the server; client
 * severity values are never trusted.
 *
 * Design decisions:
 * - Scores group continuous incidents (not per duplicate event).
 * - Duration thresholds reduce false positives from brief interruptions.
 * - Mobile browser lifecycle events get lower weights where ambiguous.
 * - Score never automatically fails a student; human review is required.
 */

export type EventType =
  | 'TAB_HIDDEN' | 'WINDOW_BLUR' | 'APP_BACKGROUND' | 'PAGE_SUSPENDED'
  | 'PAGE_RELOADED' | 'FULLSCREEN_EXIT' | 'CLIPBOARD_COPY' | 'CLIPBOARD_PASTE'
  | 'CONTEXT_MENU' | 'SUSPICIOUS_SHORTCUT' | 'UNEXPECTED_NAVIGATION'
  | 'CAMERA_PERMISSION_DENIED' | 'CAMERA_OFF' | 'CAMERA_INTERRUPTED'
  | 'CAMERA_RECOVERED' | 'CAMERA_DEVICE_CHANGED' | 'FACE_ABSENT'
  | 'MULTIPLE_FACES' | 'FACE_DETECTION_UNAVAILABLE'
  | 'RECORDING_STARTED' | 'RECORDING_INTERRUPTED' | 'RECORDING_UPLOAD_FAILED'
  | 'RECORDING_RECOVERED' | 'RECORDING_FINALIZED' | 'RECORDING_MISSING'
  | 'NETWORK_INTERRUPTED' | 'NETWORK_RECOVERED' | 'ANSWER_SYNC_FAILED'
  | 'RECORDING_SYNC_FAILED' | 'MULTIPLE_ACTIVE_SESSIONS'
  | 'SESSION_TOKEN_REUSE' | 'UNAUTHORIZED_SESSION'
  | 'SUSPICIOUS_REQUEST_RATE' | 'ATTEMPT_STATE_MISMATCH';

export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Configurable per-event risk weight. */
const DEFAULT_WEIGHTS: Partial<Record<EventType, number>> = {
  TAB_HIDDEN: 5,
  WINDOW_BLUR: 2,
  APP_BACKGROUND: 5,
  PAGE_SUSPENDED: 1,          // Often OS-driven; low weight
  PAGE_RELOADED: 3,
  FULLSCREEN_EXIT: 5,
  CLIPBOARD_COPY: 3,
  CLIPBOARD_PASTE: 3,
  CONTEXT_MENU: 2,
  SUSPICIOUS_SHORTCUT: 4,
  UNEXPECTED_NAVIGATION: 8,
  CAMERA_PERMISSION_DENIED: 10,
  CAMERA_OFF: 10,
  CAMERA_INTERRUPTED: 8,
  CAMERA_RECOVERED: 0,
  CAMERA_DEVICE_CHANGED: 5,
  FACE_ABSENT: 8,
  MULTIPLE_FACES: 12,
  FACE_DETECTION_UNAVAILABLE: 0,  // Technical, not misconduct
  RECORDING_STARTED: 0,
  RECORDING_INTERRUPTED: 10,
  RECORDING_UPLOAD_FAILED: 3,
  RECORDING_RECOVERED: 0,
  RECORDING_FINALIZED: 0,
  RECORDING_MISSING: 15,
  NETWORK_INTERRUPTED: 0,         // Expected on mobile
  NETWORK_RECOVERED: 0,
  ANSWER_SYNC_FAILED: 0,
  RECORDING_SYNC_FAILED: 2,
  MULTIPLE_ACTIVE_SESSIONS: 20,
  SESSION_TOKEN_REUSE: 20,
  UNAUTHORIZED_SESSION: 25,
  SUSPICIOUS_REQUEST_RATE: 10,
  ATTEMPT_STATE_MISMATCH: 15,
};

/** Severity classification by risk weight. */
export function classifySeverity(weight: number): SeverityLevel {
  if (weight >= 15) return 'CRITICAL';
  if (weight >= 8) return 'HIGH';
  if (weight >= 3) return 'MEDIUM';
  return 'LOW';
}

/** Risk weight for a given event type. Returns 0 for unknown types. */
export function riskWeight(eventType: string, customWeights?: Partial<Record<string, number>>): number {
  if (customWeights && eventType in customWeights) {
    return Math.max(0, customWeights[eventType] ?? 0);
  }
  return DEFAULT_WEIGHTS[eventType as EventType] ?? 0;
}

/** Compute risk weight including repetition bonus. */
export function computeEventWeight(
  eventType: string,
  existingEventCount: number,
  customWeights?: Partial<Record<string, number>>,
): number {
  const base = riskWeight(eventType, customWeights);
  // Repeated high-risk events add additional weight (capped to avoid runaway scores).
  const repetitionBonus = existingEventCount >= 3 && base >= 5 ? 5 : 0;
  return base + repetitionBonus;
}

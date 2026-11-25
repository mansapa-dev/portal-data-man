# Device & Browser Compatibility Test Matrix

## Supported Matrix & Verification Status

| Platform | Browser | Capability Detection | Preflight & Camera | MediaRecorder | Fullscreen | Visibility / Lifecycle | Status |
|---|---|---|---|---|---|---|---|
| Android | Chrome | Runtime feature check | `facingMode: "user"` | WebM (VP8/VP9) | Supported | `visibilitychange`, `pagehide`, `freeze` | Not yet tested on physical device |
| Android | Samsung Internet | Runtime feature check | `facingMode: "user"` | WebM (VP8/VP9) | Supported | `visibilitychange`, `pagehide` | Not yet tested on physical device |
| Android | Firefox Android | Runtime feature check | `facingMode: "user"` | WebM | Supported | `visibilitychange`, `pagehide` | Not yet tested on physical device |
| iOS / iPadOS | Safari | Runtime feature check | `facingMode: "user"` | MP4 (H.264) where supported | Restricted/Optional | `visibilitychange`, `pagehide`, `pageshow` | Not yet tested on physical device |
| Desktop | Chrome / Edge | Runtime feature check | `facingMode: "user"` | WebM (VP9/VP8) | Supported | `visibilitychange`, `blur`, `fullscreenchange` | Automated unit-tested; manual UI check pending |
| Desktop | Firefox | Runtime feature check | `facingMode: "user"` | WebM (VP8) | Supported | `visibilitychange`, `blur`, `fullscreenchange` | Not yet tested |
| Desktop | macOS Safari | Runtime feature check | `facingMode: "user"` | MP4 (H.264) | Supported | `visibilitychange`, `blur`, `fullscreenchange` | Not yet tested |

## Required Physical Device Scenarios
1. **Camera Permission & Revocation:** Deny permission in preflight (blocks start with clear message); revoke mid-exam (`CAMERA_OFF` / `RECORDING_INTERRUPTED`).
2. **Device Rotation & Virtual Keyboard:** Portrait ↔ landscape on 320px/360px/390px/430px widths; short-answer input focus without hiding controls.
3. **App Switching & Screen Lock:** Background app > 5s and lock screen; verify camera recovery, `TAB_HIDDEN` / `PAGE_SUSPENDED` event logging, and IndexedDB upload queue recovery.
4. **Network Switch (Wi-Fi ↔ 4G/Offline):** Disconnect network for 90s, answer questions, reconnect; verify answers sync without data loss and queued video segments upload with exponential backoff.
5. **Staff Review & Playback:** Open `StaffSecurityReview`, filter by `mobile` / `high_risk`, play segments chronologically via presigned GET URL, and verify `exam_recording_access_logs` entry.

// Browser-observable exam signals only. The web page cannot inspect OS screenshots
// or distinguish an unrelated overlay from ordinary system UI.
let examIntegrityAttached = false;
let constrainedExamViewport = false;
let viewportCheckTimer = null;

function examIntegrityActive() {
  return isUjianJalan && !isSubmitting && !document.hidden;
}

function screenshotShortcut(event) {
  if (event.key === 'PrintScreen' || event.code === 'PrintScreen') return true;
  const platform = String(navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (platform.includes('win')) return event.metaKey && event.shiftKey && String(event.key).toLowerCase() === 's';
  if (platform.includes('mac')) return event.metaKey && event.shiftKey && ['3','4','5'].includes(String(event.key));
  return false;
}

function mobileViewportConstrained() {
  if (!examIntegrityActive() || navigator.maxTouchPoints < 1) return false;
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
  const screenWidth = Number(screen.width), screenHeight = Number(screen.height);
  if (!screenWidth || !screenHeight || Math.min(screenWidth, screenHeight) > 600) return false;
  const focused = document.activeElement;
  if (focused?.matches?.('input,textarea,select,[contenteditable="true"]')) return false;
  if (window.visualViewport && Math.abs(window.visualViewport.scale - 1) > 0.05) return false;
  // Require a large, persistent reduction. Browser bars, keyboards, and rotation
  // alone must not count as a split-screen/floating-window violation.
  return window.innerWidth / screenWidth < 0.72 || window.innerHeight / screenHeight < 0.58;
}

function checkExamViewport() {
  clearTimeout(viewportCheckTimer);
  if (!examIntegrityActive()) return;
  viewportCheckTimer = setTimeout(() => {
    const constrained = mobileViewportConstrained();
    if (constrained && !constrainedExamViewport) recordExamViolation('SPLIT_SCREEN_SUSPECTED');
    constrainedExamViewport = constrained;
  }, 1500);
}

function attachExamIntegritySignals() {
  if (examIntegrityAttached) return;
  examIntegrityAttached = true;
  document.addEventListener('copy', event => {
    if (!examIntegrityActive()) return;
    event.preventDefault();
    recordExamViolation('COPY_ATTEMPT');
  }, true);
  document.addEventListener('keydown', event => {
    if (!examIntegrityActive() || event.repeat || !screenshotShortcut(event)) return;
    event.preventDefault();
    recordExamViolation('SCREENSHOT_ATTEMPT');
  }, true);
  window.addEventListener('resize', checkExamViewport);
  window.addEventListener('orientationchange', () => {
    constrainedExamViewport = false;
    clearTimeout(viewportCheckTimer);
    setTimeout(checkExamViewport, 1800);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkExamViewport();
  });
  checkExamViewport();
}

function beginExamIntegritySignals() {
  constrainedExamViewport = false;
  attachExamIntegritySignals();
  checkExamViewport();
}

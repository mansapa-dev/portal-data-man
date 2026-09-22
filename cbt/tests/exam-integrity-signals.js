const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const listeners = { document: {}, window: {} };
const recorded = [];
const timers = [];
const document = {
  hidden: false,
  hasFocus: () => true,
  activeElement: { matches: () => false },
  addEventListener: (name, handler) => { listeners.document[name] = handler; }
};
const window = {
  innerWidth: 390,
  innerHeight: 760,
  visualViewport: { scale: 1 },
  addEventListener: (name, handler) => { listeners.window[name] = handler; }
};
const context = {
  document, window,
  screen: { width: 390, height: 844 },
  navigator: { maxTouchPoints: 5, platform: 'Win32' },
  isUjianJalan: true,
  isSubmitting: false,
  recordExamViolation: type => recorded.push(type),
  setTimeout: handler => { timers.push(handler); return timers.length; },
  clearTimeout: () => {}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/assets/js/cbt/exam-integrity.js'), 'utf8'), context);
const runTimers = () => { while (timers.length) timers.shift()(); };

context.beginExamIntegritySignals();
runTimers();
assert.deepStrictEqual(recorded, [], 'Normal mobile viewport must not count');

let prevented = false;
listeners.document.copy({ preventDefault: () => { prevented = true; } });
assert(prevented, 'Copy must be blocked');
assert.deepStrictEqual(recorded, ['COPY_ATTEMPT']);

listeners.document.keydown({ key: 'PrintScreen', code: 'PrintScreen', repeat: false, preventDefault: () => {} });
assert.deepStrictEqual(recorded, ['COPY_ATTEMPT', 'SCREENSHOT_ATTEMPT']);
listeners.document.keydown({ key: 'a', code: 'KeyA', repeat: false, preventDefault: () => {} });
assert.strictEqual(recorded.length, 2, 'Ordinary typing must not count');

window.innerHeight = 530;
listeners.window.resize();
runTimers();
assert.deepStrictEqual(recorded, ['COPY_ATTEMPT', 'SCREENSHOT_ATTEMPT'], 'Small keyboard/browser changes must not count');

window.innerWidth = 190;
listeners.window.resize();
runTimers();
assert.strictEqual(recorded.at(-1), 'SPLIT_SCREEN_SUSPECTED');
listeners.window.resize();
runTimers();
assert.strictEqual(recorded.length, 3, 'Stable split screen must count only once');

window.innerWidth = 390;
listeners.window.resize();
runTimers();
document.hasFocus = () => false;
window.innerWidth = 190;
listeners.window.resize();
runTimers();
assert.strictEqual(recorded.length, 3, 'Unfocused browser UI must not count as split screen');
document.hasFocus = () => true;

context.isUjianJalan = false;
listeners.document.copy({ preventDefault: () => { throw new Error('Outside exam'); } });
assert.strictEqual(recorded.length, 3, 'Signals outside exam must not count');
console.log('Exam integrity browser signals: 9 checks passed.');

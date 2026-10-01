const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('staff dashboards and chat do not schedule background polling', () => {
  for (const file of ['cbt/staff-session.js', 'teacher/dashboard.js', 'cbt/staff-admin-chat.js']) {
    assert.doesNotMatch(read('public/assets/js/' + file), /setInterval\s*\(/, file);
  }
  const tickets = read('public/assets/js/cbt/support-tickets.js');
  assert.doesNotMatch(tickets.slice(tickets.indexOf('function stopStaff')), /set(?:Timeout|Interval)\s*\(/);
  assert.match(tickets, /studentTimer=setTimeout\(loadStudentTickets,10000\)/);
});

test('live sessions failed load retries only on user action, with no visibility polling', async () => {
  const makeNode = () => ({ children: [], addEventListener(event, fn) { this[event] = fn; }, replaceChildren(...nodes) { this.children = nodes; } });
  const root = makeNode(), notice = {}, window = {};
  let requests = 0;
  vm.runInNewContext(read('public/assets/js/teacher/live-sessions.js'), {
    window, document: { createElement: makeNode },
    clearInterval() {}, setInterval() { throw Error('No clock expected on failed load'); },
  });
  window.CbtLiveSessions.mount(root, async () => { requests++; throw Error('offline'); }, notice);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.match(notice.textContent, /offline/);
  await root.children[1].click();
  assert.equal(requests, 2);
  window.CbtLiveSessions.stop();
  await root.children[1].click();
  assert.equal(requests, 2);
});

test('manual refresh controls and cache-busting are present', () => {
  assert.match(read('resources/views/teacher/dashboard.php'), /id="teacherRefresh"/);
  assert.match(read('public/assets/js/teacher/dashboard.js'), /await openSection\(activeSection\)/);
  for (const file of ['index.html', 'resources/views/teacher/dashboard.php']) {
    assert.match(read(file), /live-sessions\.js\?v=20261001-manual-refresh-1/);
  }
  assert.doesNotMatch(read('public/assets/js/teacher/live-sessions.js'), /setTimeout|visibilitychange/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/assets/js/native-api-adapter.js'), 'utf8');

function client(loginStatuses, refreshFails = false) {
  const requests = [];
  let tokens = 0;
  const window = { addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(source, {
    window, setTimeout, clearTimeout, AbortController,
    CustomEvent: class {},
    fetch: async (url, options) => {
      requests.push({ url, body: options.body, token: options.headers?.['X-CSRF-Token'] });
      let status = 200, data = {};
      if (url === 'api/auth/me') {
        tokens++;
        if (refreshFails && tokens > 1) status = 503;
        data = { csrf_token: `token-${tokens}` };
      } else if (url === 'api/auth/student/login') {
        status = loginStatuses.shift();
        data = { nisn: '0000000001', nama: 'Test', kelas: 'X' };
      } else if (url === 'api/student/exams') data = [];
      return { ok: status < 400, status, text: async () => JSON.stringify({ data, message: 'test error' }) };
    }
  });
  return {
    requests,
    login: () => new Promise((resolve, reject) => window.cbtApi.withSuccessHandler(resolve).withFailureHandler(reject).loginSiswaAPI('0000000001', '1234'))
  };
}

test('419 refreshes token and replays the same login once', async () => {
  const c = client([419, 200]);
  assert.equal((await c.login()).success, true);
  const writes = c.requests.filter(r => r.url.endsWith('/login'));
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body, writes[1].body);
  assert.equal(writes[0].token, 'token-1');
  assert.equal(writes[1].token, 'token-2');
});

test('persistent 419 stops after one replay', async () => {
  const c = client([419, 419]);
  await assert.rejects(c.login(), e => e.status === 419);
  assert.equal(c.requests.filter(r => r.url.endsWith('/login')).length, 2);
});

test('failed session refresh does not replay a write', async () => {
  const c = client([419], true);
  await assert.rejects(c.login(), /Sesi belum/);
  assert.equal(c.requests.filter(r => r.url.endsWith('/login')).length, 1);
});

test('ambiguous gateway timeout does not replay login', async () => {
  const c = client([504]);
  await assert.rejects(c.login(), e => e.status === 504);
  assert.equal(c.requests.filter(r => r.url.endsWith('/login')).length, 1);
});

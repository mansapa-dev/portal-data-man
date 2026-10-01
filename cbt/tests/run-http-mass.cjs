// Cross-platform runner for the existing isolated HTTP integration suite.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
assert.equal(process.env.CBT_TEST_ISOLATED, '1', 'Isolated localhost MySQL required');
const cwd = path.resolve(__dirname, '..');
const php = process.env.CBT_TEST_PHP || 'php';
const workers = Number(process.env.CBT_TEST_WORKERS || 4);
assert(Number.isInteger(workers) && workers >= 1 && workers <= 32);
const env = { ...process.env, DB_HOST: '127.0.0.1', DB_PORT: '13317',
  DB_DATABASE: 'cbt_http_mass_test', DB_USERNAME: 'root', DB_PASSWORD: '',
  APP_ENV: 'testing', APP_DEBUG: 'false', SESSION_SECURE_COOKIE: 'false',
  REDIS_ENABLED: 'false', LOGIN_IP_LIMIT: '4000',
  APP_KEY: 'isolated-cbt-test-key-only-32-characters' };
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(args) {
  const result = spawnSync(php, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'PHP fixture failed');
}
async function main() {
  // Refuse to target unrelated listeners.
  for (let i = 0; i < workers; i++) await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(18471 + i, '127.0.0.1', () => server.close(resolve));
  });
  run(['tests/http-fixture.php']);
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'cbt-http-'));
  const log = fs.openSync(path.join(state, 'php.log'), 'a');
  console.log('HTTP test logs:', state);
  try {
    for (let i = 0; i < workers; i++) {
      const child = spawn(php, ['-d', `session.save_path="${state.replace(/\\/g, '/')}"`, '-S', `127.0.0.1:${18471+i}`, '-t', 'public', 'public/index.php'], { cwd, env, stdio: ['ignore', log, log], windowsHide: true });
      child.on('error', error => { console.error(error); });
      children.push(child);
    }
    await delay(1500);
    const result = await new Promise((resolve, reject) => {
      const test = spawn(process.execPath, ['tests/http-mass-exam.cjs', env.CBT_TEST_STUDENTS || '80'], { cwd, env, stdio: 'inherit', windowsHide: true });
      test.once('error', reject); test.once('exit', resolve);
    });
    assert.equal(result, 0, 'HTTP integration failed');
  } finally {
    await Promise.all(children.map(child => new Promise(resolve => {
      if (child.exitCode !== null || !child.pid) return resolve();
      child.once('exit', resolve); child.kill();
    })));
    fs.closeSync(log);
    run(['tests/http-fixture.php', 'cleanup']);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

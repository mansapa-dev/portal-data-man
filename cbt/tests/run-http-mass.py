#!/usr/bin/env python3
"""Disposable localhost HTTP simulation; requires the isolated MySQL on 13317."""
import os
import pathlib
import socket
import subprocess
import tempfile
import time

if os.environ.get('CBT_TEST_ISOLATED') != '1':
    raise SystemExit('Set CBT_TEST_ISOLATED=1; never use production database credentials.')
root = pathlib.Path(__file__).resolve().parents[1]
env = os.environ | {
    'DB_HOST': '127.0.0.1', 'DB_PORT': '13317', 'DB_DATABASE': 'cbt_http_mass_test',
    'DB_USERNAME': 'root', 'DB_PASSWORD': '', 'APP_ENV': 'testing',
    'APP_DEBUG': 'false', 'SESSION_SECURE_COOKIE': 'false',
    'LOGIN_IP_LIMIT': '4000', 'APP_KEY': 'isolated-cbt-test-key-only-32-characters',
}
workers = int(env.get('CBT_TEST_WORKERS', '4'))
assert 1 <= workers <= 32
# Refuse to send fixture traffic to an unrelated existing listener.
for port in range(18471, 18471 + workers):
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', port))
subprocess.run(['php', 'tests/http-fixture.php'], cwd=root, env=env, check=True)
processes = []
try:
    with tempfile.TemporaryDirectory(prefix='cbt-http-') as state:
        with open(pathlib.Path(state) / 'php.log', 'w') as log:
            for port in range(18471, 18471 + workers):
                processes.append(subprocess.Popen([
                    'php', '-d', f'session.save_path={state}', '-d', 'opcache.enable_cli='+env.get('CBT_TEST_OPCACHE','0'), '-S', f'127.0.0.1:{port}',
                    '-t', 'public', 'public/index.php',
                ], cwd=root, env=env, stdout=log, stderr=log))
            for port in range(18471, 18471 + workers):
                for retry in range(50):
                    try:
                        with socket.create_connection(('127.0.0.1', port), timeout=1):
                            break
                    except OSError:
                        time.sleep(.1)
                else:
                    raise RuntimeError(f'Fixture worker {port} did not start')
            subprocess.run(['node', 'tests/http-mass-exam.cjs', env.get('CBT_TEST_STUDENTS', '1300')], cwd=root, env=env, check=True)
finally:
    for process in processes:
        process.terminate()
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    subprocess.run(['php', 'tests/http-fixture.php', 'cleanup'], cwd=root, env=env, check=True)

import assert from 'node:assert/strict';
import test from 'node:test';
import { claimsFromRequest, issueToken, rateLimitKey } from '../dist/lib/auth.js';

const claims = (role, sub) => issueToken({ role, sub, exp: Math.floor(Date.now() / 1000) + 60, csrf: 'test-csrf' });

test('rate limit mengenali identitas siswa dari Bearer token', () => {
  const token = claims('STUDENT', 17);
  assert.equal(rateLimitKey({ headers: { authorization: `Bearer ${token}` }, ip: '192.0.2.1' }), 'STUDENT:17');
});

test('rate limit mengenali sesi siswa cookie-only setelah refresh', () => {
  const token = claims('STUDENT', 17);
  assert.equal(rateLimitKey({ headers: { cookie: `arena_student_session=${token}` }, ip: '192.0.2.1' }), 'STUDENT:17');
});

test('rate limit mengenali sesi staf dari cookie dan mengabaikan cookie invalid', () => {
  const token = claims('ADMIN', 4);
  assert.equal(rateLimitKey({ headers: { cookie: `other=x; arena_staff_session=${token}` }, ip: '192.0.2.1' }), 'ADMIN:4');
  assert.equal(rateLimitKey({ headers: { cookie: 'arena_student_session=invalid' }, ip: '192.0.2.1' }), 'ip:192.0.2.1');
});

test('rate limit key tidak mengubah validasi autentikasi cookie', () => {
  const request = { headers: { cookie: 'arena_student_session=invalid' }, url: '/api/student/exams', ip: '192.0.2.1' };
  assert.equal(rateLimitKey(request), 'ip:192.0.2.1');
  assert.throws(() => claimsFromRequest(request), { statusCode: 401 });
});

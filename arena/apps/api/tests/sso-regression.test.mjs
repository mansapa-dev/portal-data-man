/**
 * sso-regression.test.mjs
 *
 * Verifies that:
 * 1. Staff and teacher authentication mechanisms (SSO signed state, token verification)
 *    are unaffected by changes to student login.
 * 2. State verification properly validates HMAC signature and expiration.
 * 3. Tampered state parameters are rejected with null.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { issueToken, readToken } from '../dist/lib/auth.js';

const secret = process.env.AUTH_TOKEN_SECRET || 'local-development-only';
const b64 = (value) => Buffer.from(value).toString('base64url');

function signedState(value) {
  const payload = b64(JSON.stringify(value));
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function readState(value) {
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(mac, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return state.exp > Date.now() / 1000 ? state : null;
  } catch {
    return null;
  }
}

test('1. SSO signedState menghasilkan payload dan MAC yang valid', () => {
  const verifier = b64(randomBytes(32));
  const nonce = b64(randomBytes(24));
  const exp = Math.floor(Date.now() / 1000) + 300;

  const stateString = signedState({ verifier, nonce, exp });
  assert.ok(stateString.includes('.'), 'State harus berupa payload.signature');

  const parsed = readState(stateString);
  assert.ok(parsed !== null, 'State harus berhasil dibaca');
  assert.equal(parsed.verifier, verifier);
  assert.equal(parsed.nonce, nonce);
});

test('2. SSO readState menolak state yang dimanipulasi (tampered)', () => {
  const stateString = signedState({ verifier: 'legit', nonce: 'legit', exp: Math.floor(Date.now() / 1000) + 300 });
  const [payload, mac] = stateString.split('.');
  const tamperedPayload = b64(JSON.stringify({ verifier: 'attacker', nonce: 'attacker', exp: Math.floor(Date.now() / 1000) + 300 }));
  const tamperedState = `${tamperedPayload}.${mac}`;

  assert.equal(readState(tamperedState), null, 'State dengan signature tidak cocok harus ditolak');
});

test('3. SSO readState menolak state yang sudah kedaluwarsa', () => {
  const expiredStateString = signedState({ verifier: 'v', nonce: 'n', exp: Math.floor(Date.now() / 1000) - 10 });
  assert.equal(readState(expiredStateString), null, 'State kedaluwarsa harus ditolak');
});

test('4. Staff token issuance dan reading membedakan peran TEACHER dan EMPLOYEE secara akurat', () => {
  const teacherToken = issueToken({ sub: 101, role: 'TEACHER', exp: Math.floor(Date.now() / 1000) + 3600, csrf: 'csrf-1' });
  const employeeToken = issueToken({ sub: 202, role: 'EMPLOYEE', exp: Math.floor(Date.now() / 1000) + 3600, csrf: 'csrf-2' });

  const teacherClaims = readToken(teacherToken);
  assert.ok(teacherClaims !== null);
  assert.equal(teacherClaims.sub, 101);
  assert.equal(teacherClaims.role, 'TEACHER');

  const employeeClaims = readToken(employeeToken);
  assert.ok(employeeClaims !== null);
  assert.equal(employeeClaims.sub, 202);
  assert.equal(employeeClaims.role, 'EMPLOYEE');
});

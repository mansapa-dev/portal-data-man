import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStudentDigits, readToken, issueToken } from '../dist/lib/auth.js';

function ticketRateKey(request) {
  const bearer = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined;
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('arena_student_session='))?.slice('arena_student_session='.length);
  const claims = readToken(bearer ?? cookie ?? '');
  if (claims?.role === 'STUDENT') return `support-ticket:student:${claims.sub}`;
  const rawNisn = typeof request.body === 'object' && request.body !== null && 'nisn' in request.body ? request.body.nisn : '';
  const bodyNisn = normalizeStudentDigits(String(rawNisn ?? '')).slice(0, 20);
  if (bodyNisn) return `support-ticket:nisn:${bodyNisn}`;
  return `support-ticket:ip:${request.ip}`;
}

test('ticketRateKey menggunakan student ID saat siswa memiliki sesi aktif', () => {
  const token = issueToken({ role: 'STUDENT', sub: 42, exp: Math.floor(Date.now() / 1000) + 60, csrf: 'test' });
  const key = ticketRateKey({ headers: { authorization: `Bearer ${token}` }, ip: '203.0.113.1', body: {} });
  assert.equal(key, 'support-ticket:student:42');
});

test('ticketRateKey membedakan siswa tanpa sesi berdasarkan NISN pada IP NAT sekolah yang sama', () => {
  const student1 = ticketRateKey({ headers: {}, ip: '203.0.113.1', body: { nisn: '0012345678' } });
  const student2 = ticketRateKey({ headers: {}, ip: '203.0.113.1', body: { nisn: '0087654321' } });

  assert.equal(student1, 'support-ticket:nisn:0012345678');
  assert.equal(student2, 'support-ticket:nisn:0087654321');
  assert.notEqual(student1, student2, 'Dua siswa berbeda dari satu IP sekolah harus memiliki rate limit key terpisah');
});

test('ticketRateKey jatuh ke IP hanya jika tidak ada token dan tidak ada NISN', () => {
  const anon = ticketRateKey({ headers: {}, ip: '203.0.113.1', body: {} });
  assert.equal(anon, 'support-ticket:ip:203.0.113.1');
});

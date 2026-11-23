import assert from 'node:assert/strict';
import test from 'node:test';
import { nextFacePresenceUpdate } from '../dist/services/face-presence.js';

test('OK selalu mengosongkan timestamp ketidakhadiran', () => {
  assert.deepEqual(nextFacePresenceUpdate('ABSENT', true, 'OK'), { setStartedAt: false, clearStartedAt: true });
  assert.deepEqual(nextFacePresenceUpdate('CAMERA_OFF', true, 'OK'), { setStartedAt: false, clearStartedAt: true });
  assert.deepEqual(nextFacePresenceUpdate('UNKNOWN', false, 'OK'), { setStartedAt: false, clearStartedAt: true });
});

test('transisi OK/UNKNOWN ke ABSENT/CAMERA_OFF mencatat waktu awal baru', () => {
  assert.deepEqual(nextFacePresenceUpdate('OK', false, 'ABSENT'), { setStartedAt: true, clearStartedAt: false });
  assert.deepEqual(nextFacePresenceUpdate('UNKNOWN', false, 'ABSENT'), { setStartedAt: true, clearStartedAt: false });
  assert.deepEqual(nextFacePresenceUpdate(null, false, 'CAMERA_OFF'), { setStartedAt: true, clearStartedAt: false });
});

test('episode ABSENT berlanjut tidak mereset timestamp', () => {
  assert.deepEqual(nextFacePresenceUpdate('ABSENT', true, 'ABSENT'), { setStartedAt: false, clearStartedAt: false });
});

test('ABSENT -> CAMERA_OFF dalam satu episode tidak mereset timestamp', () => {
  assert.deepEqual(nextFacePresenceUpdate('ABSENT', true, 'CAMERA_OFF'), { setStartedAt: false, clearStartedAt: false });
  assert.deepEqual(nextFacePresenceUpdate('CAMERA_OFF', true, 'ABSENT'), { setStartedAt: false, clearStartedAt: false });
});

test('status gangguan lama tanpa timestamp tetap diisi waktu awal (fallback aman)', () => {
  assert.deepEqual(nextFacePresenceUpdate('ABSENT', false, 'CAMERA_OFF'), { setStartedAt: true, clearStartedAt: false });
});

test('recovery lalu gangguan baru mencatat episode baru (setelah OK timestamp kosong)', () => {
  assert.deepEqual(nextFacePresenceUpdate('OK', false, 'CAMERA_OFF'), { setStartedAt: true, clearStartedAt: false });
});

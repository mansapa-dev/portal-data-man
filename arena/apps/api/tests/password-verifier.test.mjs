/**
 * password-verifier.test.mjs
 *
 * Unit dan boundary tests untuk Worker-Thread Password Verifier.
 * Menggunakan native bcrypt.
 *
 * 1. Correct verification: matching PIN returns true, non-matching returns false.
 * 2. Malformed hash: worker catches and returns graceful false without 503 or crashing.
 * 3. Concurrent verification: multiple in-flight jobs are dispatched across worker slots and resolve.
 * 4. Cancellation: AbortSignal rejects with 499 and avoids wasted work.
 * 5. Backward compatibility: hash yang dibuat oleh bcryptjs (format $2a$) dapat diverifikasi.
 * 6. Credential change semantics: perubahan PIN langsung berlaku, tidak ada cache basi.
 * 7. Measurement separation: verifyPasswordDetails mengembalikan queueWaitMs dan computeMs terpisah.
 * 8. Graceful shutdown: closePasswordVerifier() terminates workers and prevents new jobs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import { verifyPassword, verifyPasswordDetails, closePasswordVerifier, getVerifierStats } from '../dist/services/password-verifier.js';

const BCRYPTJS_LEGACY_HASH = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';
const BCRYPTJS_LEGACY_PASSWORD = 'password';

test('1. verifyPassword mengembalikan true untuk PIN yang benar dan false untuk PIN yang salah', async () => {
  const pinHash = await bcrypt.hash('5678', 10);
  const correct = await verifyPassword('5678', pinHash);
  assert.equal(correct, true, 'PIN yang benar harus menghasilkan true');

  const incorrect = await verifyPassword('0000', pinHash);
  assert.equal(incorrect, false, 'PIN yang salah harus menghasilkan false');
});

test('2. verifyPassword menangani hash tidak valid dengan aman (false) tanpa merusak worker', async () => {
  // Hash yang bukan format bcrypt valid tidak membuat worker crash atau 503, melainkan ditolak sebagai tidak cocok (false)
  const result = await verifyPassword('1234', 'not-a-valid-bcrypt-hash');
  assert.equal(result, false, 'Hash tidak valid harus dianggap tidak cocok (false)');

  const emptyResult = await verifyPassword('1234', '');
  assert.equal(emptyResult, false, 'Hash kosong harus dianggap tidak cocok (false)');

  // Verifikasi bahwa worker tetap sehat dan dapat memproses request berikutnya
  const pinHash = await bcrypt.hash('9999', 10);
  const valid = await verifyPassword('9999', pinHash);
  assert.equal(valid, true, 'Worker harus tetap berfungsi normal setelah verifikasi hash tidak valid');
});

test('3. verifyPassword menangani burst concurrent verifikasi secara konsisten', async () => {
  const pins = ['1111', '2222', '3333', '4444', '5555', '6666'];
  const hashes = await Promise.all(pins.map((pin) => bcrypt.hash(pin, 10)));

  const results = await Promise.all(
    pins.map((pin, index) => verifyPassword(pin, hashes[index])),
  );

  assert.equal(results.length, pins.length);
  assert.ok(results.every((result) => result === true), 'Semua verifikasi paralel harus sukses');
});

test('4. verifyPassword menolak request yang dibatalkan oleh AbortSignal tanpa membuang kerja CPU', async () => {
  const pinHash = await bcrypt.hash('1234', 10);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    verifyPassword('1234', pinHash, controller.signal),
    { statusCode: 499 },
    'Request yang sudah dibatalkan harus langsung ditolak dengan 499',
  );
});

test('5. verifyPassword menerima hash lama yang dibuat bcryptjs (backward compatibility)', async () => {
  const correct = await verifyPassword(BCRYPTJS_LEGACY_PASSWORD, BCRYPTJS_LEGACY_HASH);
  assert.equal(correct, true, 'Hash $2a$ dari bcryptjs harus diterima oleh native bcrypt worker');

  const wrong = await verifyPassword('wrong-password', BCRYPTJS_LEGACY_HASH);
  assert.equal(wrong, false, 'Password salah pada hash bcryptjs harus ditolak');
});

test('6. Perubahan kredensial langsung berlaku tanpa ada cache hasil verifikasi lama', async () => {
  const oldPin = '1234';
  const newPin = '5678';
  const oldHash = await bcrypt.hash(oldPin, 10);
  const newHash = await bcrypt.hash(newPin, 10);

  // Verifikasi PIN lama cocok
  const first = await verifyPassword(oldPin, oldHash);
  assert.equal(first, true);

  // Jika hash di-update ke PIN baru, PIN lama langsung ditolak
  const oldRejected = await verifyPassword(oldPin, newHash);
  assert.equal(oldRejected, false, 'PIN lama harus langsung ditolak setelah hash diperbarui');

  // PIN baru langsung diterima
  const newAccepted = await verifyPassword(newPin, newHash);
  assert.equal(newAccepted, true, 'PIN baru harus langsung diterima');
});

test('7. verifyPasswordDetails memisahkan queueWaitMs dan computeMs dengan akurat', async () => {
  const pinHash = await bcrypt.hash('4321', 10);
  const details = await verifyPasswordDetails('4321', pinHash);

  assert.equal(details.valid, true);
  assert.equal(typeof details.queueWaitMs, 'number');
  assert.equal(typeof details.computeMs, 'number');
  assert.ok(details.computeMs > 0, 'computeMs harus mencatat waktu komputasi bcrypt CPU');
  assert.ok(details.queueWaitMs >= 0, 'queueWaitMs harus bernilai >= 0');
});

test('8. closePasswordVerifier mematikan worker dan menolak verifikasi baru dengan 503', async () => {
  const statsBefore = getVerifierStats();
  assert.ok(statsBefore.workers > 0);

  await closePasswordVerifier();

  await assert.rejects(
    verifyPassword('1234', '$2a$10$abcdefghijklmnopqrstuv'),
    { statusCode: 503 },
  );
});

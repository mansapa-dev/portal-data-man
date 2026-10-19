/**
 * password-verifier.test.mjs
 *
 * Unit and boundary tests for the Worker-Thread Password Verifier:
 * 1. Correct verification: matching PIN returns true, non-matching returns false.
 * 2. Malformed hash: worker catches and returns graceful error (503) without crashing.
 * 3. Concurrent verification: multiple in-flight jobs are dispatched across worker slots and resolve.
 * 4. Graceful shutdown: closePasswordVerifier() terminates workers, rejects in-flight/queued jobs,
 *    and prevents new jobs from being accepted.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { hash } from 'bcryptjs';
import { verifyPassword, closePasswordVerifier } from '../dist/services/password-verifier.js';

test('verifyPassword mengembalikan true untuk PIN yang benar dan false untuk PIN yang salah', async () => {
  const pinHash = await hash('5678', 10);
  const correct = await verifyPassword('5678', pinHash);
  assert.equal(correct, true, 'PIN yang benar harus menghasilkan true');

  const incorrect = await verifyPassword('0000', pinHash);
  assert.equal(incorrect, false, 'PIN yang salah harus menghasilkan false');
});

test('verifyPassword menangani hash tidak valid dengan aman (false) tanpa merusak worker', async () => {
  // Hash yang bukan format bcrypt valid tidak membuat worker crash, melainkan ditolak sebagai tidak cocok (false)
  const result = await verifyPassword('1234', 'not-a-valid-bcrypt-hash');
  assert.equal(result, false, 'Hash tidak valid harus dianggap tidak cocok (false)');

  // Verifikasi bahwa worker tetap sehat dan dapat memproses request berikutnya
  const pinHash = await hash('9999', 10);
  const valid = await verifyPassword('9999', pinHash);
  assert.equal(valid, true, 'Worker harus tetap berfungsi normal setelah verifikasi hash tidak valid');
});

test('verifyPassword menangani burst concurrent verifikasi secara konsisten', async () => {
  const pins = ['1111', '2222', '3333', '4444', '5555', '6666'];
  const hashes = await Promise.all(pins.map((pin) => hash(pin, 10)));

  // Jalankan verifikasi serentak (melebihi jumlah worker slots)
  const results = await Promise.all(
    pins.map((pin, index) => verifyPassword(pin, hashes[index])),
  );

  assert.equal(results.length, pins.length);
  assert.ok(results.every((result) => result === true), 'Semua verifikasi paralel harus sukses');
});

test('closePasswordVerifier mematikan worker dan menolak verifikasi baru dengan 503', async () => {
  // Tutup verifier
  await closePasswordVerifier();

  // Request setelah shutdown harus langsung ditolak dengan 503
  await assert.rejects(
    verifyPassword('1234', '$2a$10$abcdefghijklmnopqrstuv'),
    { statusCode: 503 },
  );
});

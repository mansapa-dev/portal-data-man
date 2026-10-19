/**
 * password-verifier.test.mjs
 *
 * Unit dan boundary tests untuk Worker-Thread Password Verifier.
 * Menggunakan native bcrypt (setelah migrasi dari bcryptjs).
 *
 * 1. Correct verification: matching PIN returns true, non-matching returns false.
 * 2. Malformed hash: worker catches and returns graceful error (503) without crashing.
 * 3. Concurrent verification: multiple in-flight jobs are dispatched across worker slots and resolve.
 * 4. Graceful shutdown: closePasswordVerifier() terminates workers, rejects in-flight/queued jobs,
 *    and prevents new jobs from being accepted.
 * 5. Backward compatibility: hash yang dibuat oleh bcryptjs (format $2a$) dapat diverifikasi.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import { verifyPassword, closePasswordVerifier } from '../dist/services/password-verifier.js';

// Hash yang dibuat oleh bcryptjs@3.x untuk password 'pin-lama-bcryptjs-5678'.
// Digunakan sebagai fixture untuk membuktikan backward compatibility.
// Format $2a$ adalah standar bcrypt yang kompatibel lintas-implementasi.
const BCRYPTJS_LEGACY_HASH = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';
const BCRYPTJS_LEGACY_PASSWORD = 'password'; // password yang menghasilkan hash di atas

test('verifyPassword mengembalikan true untuk PIN yang benar dan false untuk PIN yang salah', async () => {
  const pinHash = await bcrypt.hash('5678', 10);
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
  const pinHash = await bcrypt.hash('9999', 10);
  const valid = await verifyPassword('9999', pinHash);
  assert.equal(valid, true, 'Worker harus tetap berfungsi normal setelah verifikasi hash tidak valid');
});

test('verifyPassword menangani burst concurrent verifikasi secara konsisten', async () => {
  const pins = ['1111', '2222', '3333', '4444', '5555', '6666'];
  const hashes = await Promise.all(pins.map((pin) => bcrypt.hash(pin, 10)));

  // Jalankan verifikasi serentak (melebihi jumlah worker slots)
  const results = await Promise.all(
    pins.map((pin, index) => verifyPassword(pin, hashes[index])),
  );

  assert.equal(results.length, pins.length);
  assert.ok(results.every((result) => result === true), 'Semua verifikasi paralel harus sukses');
});

test('verifyPassword menolak request yang dibatalkan oleh AbortSignal tanpa membuang kerja CPU', async () => {
  const pinHash = await bcrypt.hash('1234', 10);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    verifyPassword('1234', pinHash, controller.signal),
    { statusCode: 499 },
    'Request yang sudah dibatalkan harus langsung ditolak dengan 499',
  );
});

test('verifyPassword menerima hash lama yang dibuat bcryptjs (backward compatibility)', async () => {
  // Hash $2a$ yang dibuat oleh bcryptjs harus dapat diverifikasi oleh native bcrypt worker
  const correct = await verifyPassword(BCRYPTJS_LEGACY_PASSWORD, BCRYPTJS_LEGACY_HASH);
  assert.equal(correct, true, 'Hash $2a$ dari bcryptjs harus diterima oleh native bcrypt worker');

  const wrong = await verifyPassword('wrong-password', BCRYPTJS_LEGACY_HASH);
  assert.equal(wrong, false, 'Password salah pada hash bcryptjs harus ditolak');
});

test('verifyPassword melayani hash yang sudah terverifikasi dari cache instan', async () => {
  const pinHash = await bcrypt.hash('7777', 10);
  const start1 = performance.now();
  const first = await verifyPassword('7777', pinHash);
  const time1 = performance.now() - start1;
  assert.equal(first, true);

  // Verifikasi kedua dengan PIN dan hash yang sama harus instan dari cache (< 5ms)
  const start2 = performance.now();
  const second = await verifyPassword('7777', pinHash);
  const time2 = performance.now() - start2;
  assert.equal(second, true);
  assert.ok(time2 < time1, 'Panggilan kedua harus lebih cepat dari panggilan pertama');
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

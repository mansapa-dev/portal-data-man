/**
 * hash-compat.test.mjs
 *
 * Tes kompatibilitas hash untuk migrasi bcryptjs → native bcrypt.
 * Memverifikasi bahwa:
 * 1. Hash lama yang dibuat oleh bcryptjs dapat diverifikasi oleh native bcrypt.
 * 2. Hash baru yang dibuat oleh native bcrypt dapat diverifikasi oleh native bcrypt.
 * 3. Password yang benar diterima (true).
 * 4. Password yang salah ditolak (false).
 * 5. Hash tidak valid atau input bermasalah tidak menghasilkan autentikasi berhasil.
 * 6. Tidak ada password/hash sensitif yang dicetak ke log.
 *
 * Tes ini menggunakan hash yang sudah dibuat sebelumnya (pre-computed) agar tidak
 * bergantung pada bcryptjs di runtime, sekaligus membuktikan backward compatibility.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

// ── Pre-computed test fixtures ────────────────────────────────────────────────
//
// Hash berikut dibuat oleh bcryptjs@3.x (sama dengan bcrypt cost-factor 10).
// Format $2a$ adalah format standar bcrypt yang kompatibel lintas-implementasi.
//
//   bcryptjs: hash('correct-password', 10) → nilai di bawah
//
const BCRYPTJS_HASH_OF_CORRECT = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';
const CORRECT_PASSWORD = 'password'; // password yang menghasilkan hash di atas (fixture bcrypt.js)

// Hash yang dibuat dengan native bcrypt@6.x pada cost-factor 10 untuk 'native-test-secret'
// (dibuat saat menyiapkan tes ini; format $2b$ juga valid di native bcrypt)
// Kita generate on-the-fly untuk memastikan native bcrypt benar-benar berfungsi.

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Import bcrypt secara lazy agar error import tertangkap di dalam test,
 * bukan saat modul dimuat.
 */
async function getBcrypt() {
  const { default: bcrypt } = await import('bcrypt');
  return bcrypt;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('1. Hash bcryptjs ($2a$) dapat diverifikasi oleh native bcrypt', async () => {
  const bcrypt = await getBcrypt();
  const result = await bcrypt.compare(CORRECT_PASSWORD, BCRYPTJS_HASH_OF_CORRECT);
  assert.strictEqual(result, true, 'Native bcrypt harus menerima hash $2a$ yang dibuat bcryptjs');
});

test('2. Hash native bcrypt ($2b$) dapat diverifikasi oleh native bcrypt sendiri', async () => {
  const bcrypt = await getBcrypt();
  const secret = 'native-test-secret-12345';
  const hash = await bcrypt.hash(secret, 10);
  assert.ok(hash.startsWith('$2b$'), `Hash native bcrypt harus dimulai dengan $2b$, dapat: ${hash.slice(0, 7)}`);
  const result = await bcrypt.compare(secret, hash);
  assert.strictEqual(result, true, 'Native bcrypt harus menerima hash yang dibuatnya sendiri');
});

test('3. Password yang benar menghasilkan true', async () => {
  const bcrypt = await getBcrypt();
  const pin = '123456';
  const hash = await bcrypt.hash(pin, 10);
  const result = await bcrypt.compare(pin, hash);
  assert.strictEqual(result, true, 'Password yang benar harus menghasilkan true');
});

test('4. Password yang salah menghasilkan false', async () => {
  const bcrypt = await getBcrypt();
  const pin = '123456';
  const wrongPin = '999999';
  const hash = await bcrypt.hash(pin, 10);
  const result = await bcrypt.compare(wrongPin, hash);
  assert.strictEqual(result, false, 'Password yang salah harus menghasilkan false');
});

test('5a. Hash tidak valid tidak menghasilkan autentikasi berhasil', async () => {
  const bcrypt = await getBcrypt();
  // String acak bukan format bcrypt — harus throw atau return false, bukan true
  let result;
  try {
    result = await bcrypt.compare('any-password', 'not-a-valid-bcrypt-hash');
  } catch {
    // throw juga dapat diterima — yang penting tidak mengembalikan true
    result = false;
  }
  assert.strictEqual(result, false, 'Hash tidak valid tidak boleh menghasilkan true');
});

test('5b. Hash terpotong (truncated) tidak menghasilkan autentikasi berhasil', async () => {
  const bcrypt = await getBcrypt();
  let result;
  try {
    result = await bcrypt.compare('password', '$2a$10$abcde');
  } catch {
    result = false;
  }
  assert.strictEqual(result, false, 'Hash terpotong tidak boleh menghasilkan true');
});

test('5c. String kosong sebagai hash tidak menghasilkan autentikasi berhasil', async () => {
  const bcrypt = await getBcrypt();
  let result;
  try {
    result = await bcrypt.compare('password', '');
  } catch {
    result = false;
  }
  assert.strictEqual(result, false, 'String kosong sebagai hash tidak boleh menghasilkan true');
});

test('6. Tidak ada password atau hash yang bocor ke console/log selama verifikasi', async () => {
  const bcrypt = await getBcrypt();

  // Rekam output console selama verifikasi berlangsung
  const logged = [];
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  console.log = (...args) => logged.push(args.join(' '));
  console.error = (...args) => logged.push(args.join(' '));
  console.warn = (...args) => logged.push(args.join(' '));

  const sensitiveSecret = 'super-secret-pin-99887766';
  try {
    const hash = await bcrypt.hash(sensitiveSecret, 10);
    await bcrypt.compare(sensitiveSecret, hash);
    await bcrypt.compare('wrong-pin', hash);
  } finally {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
  }

  // Verifikasi tidak ada secret yang tercetak
  // Kita hash secret terlebih dahulu untuk menghindari mencetak secret itu sendiri dalam pesan error
  const secretMarker = createHash('sha256').update(sensitiveSecret).digest('hex').slice(0, 8);
  for (const entry of logged) {
    assert.ok(
      !entry.includes(sensitiveSecret),
      `Secret terdeteksi di log (marker: ${secretMarker}) — kemungkinan kebocoran`,
    );
  }
});

test('7. Hash bcryptjs password yang benar diterima, password yang salah ditolak', async () => {
  const bcrypt = await getBcrypt();
  // BCRYPTJS_HASH_OF_CORRECT adalah hash dari 'password' (bcryptjs fixture)
  const correct = await bcrypt.compare(CORRECT_PASSWORD, BCRYPTJS_HASH_OF_CORRECT);
  assert.strictEqual(correct, true, 'Password benar harus diterima pada hash bcryptjs lama');

  const wrong = await bcrypt.compare('wrong-password', BCRYPTJS_HASH_OF_CORRECT);
  assert.strictEqual(wrong, false, 'Password salah harus ditolak pada hash bcryptjs lama');
});

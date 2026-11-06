import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const serverSource = readFileSync(new URL('../dist/server.js', import.meta.url), 'utf8');
const supportSource = readFileSync(new URL('../dist/routes/support.js', import.meta.url), 'utf8');
const adminSource = readFileSync(new URL('../dist/routes/admin.js', import.meta.url), 'utf8');

test('setErrorHandler terdaftar sebelum plugin route agar semua error tidak jatuh ke 500 default Fastify', () => {
  const handlerIndex = serverSource.indexOf('setErrorHandler');
  assert.ok(handlerIndex > 0, 'setErrorHandler wajib ada di server.js');
  const firstRouteRegister = serverSource.indexOf('app.register(authRoutes)');
  assert.ok(firstRouteRegister > 0, 'plugin route terdaftar');
  assert.ok(
    handlerIndex < firstRouteRegister,
    'setErrorHandler harus dipanggil SEBELUM plugin route (register setelah await langsung mem-boot plugin)',
  );
});

test('reset tiket otomatis mengklaim tiket, tidak lagi 409 "Ambil tiket terlebih dahulu"', () => {
  const resetIndex = supportSource.indexOf("'/api/staff/support-tickets/:id/reset'");
  assert.ok(resetIndex > 0, 'rute reset tiket harus terdaftar');
  const resetSection = supportSource.slice(resetIndex);
  assert.ok(
    !resetSection.slice(0, 5000).includes("'Ambil tiket terlebih dahulu'"),
    'pesan 409 lama harus hilang dari jalur reset tiket',
  );
  assert.match(
    supportSource,
    /UPDATE support_tickets SET status=[\s\S]{0,16}IN_PROGRESS[\s\S]{0,6},handled_by=\? WHERE id=\?/,
    'klaim otomatis wajib ada sebelum memulihkan sesi',
  );
});

test('reset-batch menerima pasangan attempts per ujian selain format student_ids lama', () => {
  const batchIndex = adminSource.indexOf("'/api/admin/students/reset-batch'");
  assert.ok(batchIndex > 0, 'rute reset-batch harus terdaftar');
  const bodyStart = adminSource.indexOf('z.object', batchIndex);
  const bodyEnd = adminSource.indexOf('parse(request.body)', bodyStart);
  const body = adminSource.slice(bodyStart, bodyEnd);
  assert.ok(body.includes('attempts'), 'schema reset-batch wajib menerima attempts pasangan siswa+ujian');
  assert.ok(body.includes('student_ids'), 'schema reset-batch tetap menerima format student_ids lama');
});

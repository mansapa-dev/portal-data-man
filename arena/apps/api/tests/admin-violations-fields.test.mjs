import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const adminSource = readFileSync(new URL('../dist/routes/admin.js', import.meta.url), 'utf8');
const staffSource = readFileSync(new URL('../dist/routes/staff.js', import.meta.url), 'utf8');

test('SELECT /api/admin/violations menyertakan student_id dan exam_id agar reset dari view pelanggaran tidak memakai NaN', () => {
  const violationsIndex = adminSource.indexOf("'/api/admin/violations'");
  assert.ok(violationsIndex > 0, 'route /api/admin/violations harus terdaftar di admin.js');
  const sqlStart = adminSource.indexOf('SELECT', violationsIndex);
  const sqlEnd = adminSource.indexOf('LIMIT ? OFFSET ?', sqlStart);
  assert.ok(sqlStart > 0 && sqlEnd > sqlStart, 'SELECT violations ditemukan');
  const sql = adminSource.slice(sqlStart, sqlEnd);
  assert.ok(sql.includes('s.id student_id'), 'kolom student_id wajib ada di SELECT admin violations');
  assert.ok(sql.includes('e.id exam_id'), 'kolom exam_id wajib ada di SELECT admin violations');
});

test('rute reset staff menolak parameter id non-digit (400) sebelum parsing', () => {
  assert.ok(
    staffSource.includes("/api/staff/students/:id/reset'") && staffSource.includes("ID siswa tidak valid"),
    'guard digit harus ada di rute reset staff',
  );
});

test('log pelanggaran mendukung filter kelas, tingkat, jenis, dan urutan stabil', () => {
  for (const source of [adminSource, staffSource]) {
    assert.ok(source.includes('s.grade_snapshot=?'), 'filter tingkat memakai grade_snapshot siswa');
    assert.ok(source.includes('s.class_snapshot=?'), 'filter kelas memakai class_snapshot siswa');
    assert.ok(source.includes('v.type=?'), 'filter jenis pelanggaran memakai violations.type');
    assert.ok(source.includes('ORDER BY v.occurred_at DESC,v.id DESC'), 'urutan pelanggaran stabil untuk pagination');
  }
});

test('bank soal menyediakan arsip dan pemulihan tanpa menghapus data', () => {
  assert.ok(adminSource.includes("'/api/admin/questions/:id/archive'"), 'rute arsip soal tersedia');
  assert.ok(adminSource.includes("'/api/admin/questions/:id/restore'"), 'rute pemulihan soal tersedia');
  assert.ok(adminSource.includes("SET status='ARCHIVED' WHERE id=?"), 'arsip mengubah status, bukan menghapus baris');
});

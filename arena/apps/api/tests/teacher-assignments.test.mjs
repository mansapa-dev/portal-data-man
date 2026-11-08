import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const adminSource = readFileSync(new URL('../dist/routes/admin.js', import.meta.url), 'utf8');
const migration002 = readFileSync(new URL('../../../database/migrations/002_staff_admin.sql', import.meta.url), 'utf8');
const migration011 = readFileSync(new URL('../../../database/migrations/011_teacher_proctor_combined.sql', import.meta.url), 'utf8');
const staffOperations = readFileSync(new URL('../../web/src/StaffOperations.tsx', import.meta.url), 'utf8');

test('enum duty_role backend, UI, dan migrasi DB konsisten memakai TEACHER_PROCTOR', () => {
  const postIndex = adminSource.indexOf("'/api/admin/teacher-assignments'");
  assert.ok(postIndex > 0, 'route POST teacher-assignments terdaftar');
  const schema = adminSource.slice(postIndex, postIndex + 800);
  assert.ok(schema.includes("'TEACHER_PROCTOR'"), 'schema POST wajib menerima TEACHER_PROCTOR');
  assert.ok(staffOperations.includes("'TEACHER_PROCTOR'"), 'UI penugasan wajib punya opsi Guru Pengampu & Pengawas');
  assert.ok(
    /MODIFY COLUMN duty_role ENUM\('TEACHER','PROCTOR','TEACHER_PROCTOR'\)/.test(migration011),
    'migrasi 011 menambah TEACHER_PROCTOR',
  );
  assert.ok(
    /duty_role ENUM\('TEACHER','PROCTOR','TEACHER_PROCTOR'\)/.test(migration002),
    'DDL dasar 002 juga memuat TEACHER_PROCTOR untuk instalasi baru',
  );
});

test('POST penugasan memblokir duplikasi termasuk "Semua Ujian" (exam_id NULL)', () => {
  const postIndex = adminSource.indexOf("'/api/admin/teacher-assignments'");
  const section = adminSource.slice(postIndex, adminSource.indexOf('app.put', postIndex));
  assert.ok(
    section.includes('teacher_id<=>? AND employee_id<=>? AND exam_id<=>?'),
    'cek duplikat harus pakai operator <=> agar baris exam_id NULL ikut terdeteksi',
  );
  assert.ok(section.includes("'Penugasan yang sama sudah ada'"), 'pesan 409 dedup wajib ada');
  assert.ok(!section.includes('ON DUPLICATE KEY UPDATE'), 'jangan insert+onduplicate lagi; path update eksplisit');
  assert.ok(section.includes("SELECT id FROM exams WHERE id=?"), 'ujian target wajib divalidasi ada');
});

test('pegawai tidak boleh jadi guru pengampu di jalur API juga', () => {
  assert.ok(
    adminSource.includes("'Pegawai hanya dapat ditugaskan sebagai pengawas'"),
    'guard pegawai-as-teacher wajib ada di API',
  );
});

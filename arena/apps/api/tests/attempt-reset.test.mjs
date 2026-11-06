import assert from 'node:assert/strict';
import test from 'node:test';
import { resetTerminatedAttemptInTransaction } from '../dist/services/attempt-reset.js';

function connectionWith(rowsByPrefix = {}) {
  const statements = [];
  return {
    statements,
    async execute(sql, params = []) {
      statements.push({ sql, params });
      for (const [prefix, rows] of Object.entries(rowsByPrefix)) {
        if (sql.startsWith(prefix)) return [rows];
      }
      return [{ affectedRows: 1 }];
    },
  };
}

test('reset hanya untuk aktor aktif dengan role yang masih cocok', async () => {
  const connection = connectionWith({
    'SELECT id,role,teacher_id,employee_id': [{ id: 8, role: 'ADMIN', teacher_id: null, employee_id: null }],
  });
  await assert.rejects(
    resetTerminatedAttemptInTransaction(connection, 12, 3, { id: 8, role: 'TEACHER' }, 'alasan reset'),
    { statusCode: 403 },
  );
  assert.equal(connection.statements.length, 1);
});

test('guru/petugas piket tidak lagi diizinkan mereset sesi (admin saja)', async () => {
  const connection = connectionWith({
    'SELECT id,role,teacher_id,employee_id': [{ id: 5, role: 'TEACHER', teacher_id: 2, employee_id: null }],
  });
  await assert.rejects(
    resetTerminatedAttemptInTransaction(connection, 12, 3, { id: 5, role: 'TEACHER' }, 'alasan reset'),
    { statusCode: 403 },
  );
  // Tidak ada lagi query izin proktor; penolakan terjadi langsung setelah validasi akun.
  assert.equal(connection.statements.length, 1);
});

test('attempt TERMINATED manual oleh admin (completed_at) dipulihkan tanpa syarat pelanggaran', async () => {
  const connection = connectionWith({
    'SELECT id,role,teacher_id,employee_id': [{ id: 8, role: 'ADMIN', teacher_id: null, employee_id: null }],
    'SELECT a.*,s.is_active,s.cbt_status': [{ id: 31, public_id: 'attempt-public', status: 'TERMINATED', violation_count: 0, starts_at: '2030-01-01 12:00:00', expires_at: '2030-01-01 13:00:00', completed_at: new Date(Date.now() - 120_000), is_active: 1, cbt_status: 'ACTIVE' }],
    'SELECT MAX(occurred_at)': [{ stopped_at: null }],
    'SELECT score, maximum_points, earned_points': [{ score: 50, maximum_points: 100, earned_points: 50 }],
  });
  const result = await resetTerminatedAttemptInTransaction(connection, 12, 3, { id: 8, role: 'ADMIN' }, 'pulihkan sesi manual');
  assert.equal(result.attempt_id, 'attempt-public');
  assert.ok(new Date(result.expires_at.replace('Z', 'Z')).getTime() > Date.now(), 'sisa waktu dihitung dari completed_at, bukan dari sekarang');
});

test('attempt EXPIRED tetap dipulihkan memakai sisa jadwal ujian (bebas status)', async () => {
  const examEndsIn1Hour = new Date(Date.now() + 60 * 60_000);
  const connection = connectionWith({
    'SELECT id,role,teacher_id,employee_id': [{ id: 8, role: 'ADMIN', teacher_id: null, employee_id: null }],
    'SELECT a.*,s.is_active,s.cbt_status': [{ id: 31, public_id: 'attempt-public', status: 'EXPIRED', violation_count: 3, started_at: '2020-01-01 12:00:00', expires_at: '2020-01-01 13:00:00', exam_ends_at: examEndsIn1Hour, is_active: 1, cbt_status: 'ACTIVE' }],
    'SELECT MAX(occurred_at)': [{ stopped_at: null }],
    'SELECT score, maximum_points, earned_points': [{ score: 0, maximum_points: 100, earned_points: 0 }],
  });
  const result = await resetTerminatedAttemptInTransaction(connection, 12, 3, { id: 8, role: 'ADMIN' }, 'pulihkan sesi kadaluarsa');
  assert.equal(result.attempt_id, 'attempt-public');
  const newExpiry = new Date(String(result.expires_at).replace('Z', 'Z')).getTime();
  assert.ok(newExpiry > Date.now(), 'sisa waktu baru harus di masa depan');
  // Sisa waktu ≈ jarak ke ends_at ujian (± toleransi 2 menit proses).
  assert.ok(
    Math.abs((examEndsIn1Hour.getTime() - newExpiry) / 60_000) < 2,
    'sisa waktu diambil dari exams.ends_at, bukan 0',
  );
});

test('attempt COMPLETED juga dapat dipulihkan (bebas, tanpa syarat status)', async () => {
  const connection = connectionWith({
    'SELECT id,role,teacher_id,employee_id': [{ id: 8, role: 'ADMIN', teacher_id: null, employee_id: null }],
    'SELECT a.*,s.is_active,s.cbt_status': [{ id: 31, public_id: 'attempt-public', status: 'COMPLETED', violation_count: 0, started_at: '2026-01-01 12:00:00', expires_at: '2030-01-01 13:00:00', completed_at: new Date(Date.now() - 60_000), is_active: 1, cbt_status: 'ACTIVE' }],
    'SELECT MAX(occurred_at)': [{ stopped_at: null }],
    'SELECT score, maximum_points, earned_points': [{ score: 80, maximum_points: 100, earned_points: 80 }],
  });
  const result = await resetTerminatedAttemptInTransaction(connection, 12, 3, { id: 8, role: 'ADMIN' }, 'pulihkan sesi selesai');
  assert.equal(result.attempt_id, 'attempt-public');
  assert.ok(new Date(String(result.expires_at).replace('Z', 'Z')).getTime() > Date.now(), 'sisa waktu dari expires_at lama masih dipakai');
});

test('sisa waktu habis dan jadwal ujian sudah berakhir ditolak 409', async () => {
  const connection = connectionWith({
    'SELECT id,role,teacher_id,employee_id': [{ id: 8, role: 'ADMIN', teacher_id: null, employee_id: null }],
    'SELECT a.*,s.is_active,s.cbt_status': [{ id: 31, public_id: 'attempt-public', status: 'EXPIRED', violation_count: 3, started_at: '2020-01-01 12:00:00', expires_at: '2020-01-01 13:00:00', exam_ends_at: '2020-01-01 14:00:00', is_active: 1, cbt_status: 'ACTIVE' }],
    'SELECT MAX(occurred_at)': [{ stopped_at: new Date('2020-01-01T12:30:00Z') }],
  });
  await assert.rejects(
    resetTerminatedAttemptInTransaction(connection, 12, 3, { id: 8, role: 'ADMIN' }, 'pulihkan sesi lama'),
    { statusCode: 409 },
  );
});

test('sisa waktu habis tanpa kolom jadwal ujian tetap ditolak 409', async () => {
  const connection = connectionWith({
    'SELECT id,role,teacher_id,employee_id': [{ id: 8, role: 'ADMIN', teacher_id: null, employee_id: null }],
    'SELECT a.*,s.is_active,s.cbt_status': [{ id: 31, public_id: 'attempt-public', status: 'TERMINATED', violation_count: 3, started_at: '2020-01-01 12:00:00', expires_at: '2020-01-01 13:00:00', is_active: 1, cbt_status: 'ACTIVE' }],
    'SELECT MAX(occurred_at)': [{ stopped_at: new Date('2020-01-01T12:30:00Z') }],
  });
  await assert.rejects(
    resetTerminatedAttemptInTransaction(connection, 12, 3, { id: 8, role: 'ADMIN' }, 'pulihkan sesi lama'),
    { statusCode: 409 },
  );
});

test('reset menyimpan nilai lama di audit dan menulis perubahan dalam transaksi pemanggil', async () => {
  const connection = connectionWith({
    'SELECT id,role,teacher_id,employee_id': [{ id: 8, role: 'ADMIN', teacher_id: null, employee_id: null }],
    'SELECT a.*,s.is_active,s.cbt_status': [{ id: 31, public_id: 'attempt-public', status: 'TERMINATED', violation_count: 3, expires_at: '2030-01-01 12:10:00', is_active: 1, cbt_status: 'ACTIVE' }],
    'SELECT MAX(occurred_at)': [{ stopped_at: new Date(Date.now() - 60_000) }],
    'SELECT score, maximum_points, earned_points': [{ score: 72, maximum_points: 100, earned_points: 72 }],
  });
  const result = await resetTerminatedAttemptInTransaction(connection, 12, 3, { id: 8, role: 'ADMIN' }, 'siswa datang ke pengawas');
  assert.equal(result.attempt_id, 'attempt-public');
  const audit = connection.statements.find((statement) => statement.sql.includes("'CBT_ATTEMPT_RESUMED'"));
  assert.ok(audit);
  assert.match(audit.params[3], /"score":72/);
  assert.ok(connection.statements.some((statement) => statement.sql.startsWith('DELETE FROM exam_results')));
  assert.ok(connection.statements.some((statement) => statement.sql.startsWith('UPDATE exam_attempts')));
});

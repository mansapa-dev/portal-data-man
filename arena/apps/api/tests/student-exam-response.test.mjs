import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

test('student start HTTP response strips answer keys and disables caching', async () => {
  process.env.DATABASE_URL ??= 'mysql://dummy:dummy@127.0.0.1:1/arena_test';
  const [{ studentExamRoutes }, { StudentExamService }, { issueToken }] = await Promise.all([
    import('../dist/routes/student-exams.js'),
    import('../dist/services/student-exam.js'),
    import('../dist/lib/auth.js'),
  ]);
  const originalStart = StudentExamService.prototype.start;
  StudentExamService.prototype.start = async () => ({
    attempt_id: 'A'.repeat(26), exam: { id: 1, nama_ujian: 'Dummy', correct_answer: 'B' },
    expires_at: new Date(Date.now() + 60000).toISOString(), server_time: new Date().toISOString(),
    correct_answer: 'B', kunci: 'B', pembahasan: 'Rahasia', option_mapping: { 5: ['A'] },
    soal: [{ id: 5, tipe: 'MULTIPLE_CHOICE', pertanyaan: 'Soal dummy', poin: 1,
      correct_answer: 'B', kunci: 'B', pembahasan: 'Rahasia',
      opsi: [{ key: 'A', text: 'Pilihan', correct_answer: 'B' }],
    }], jawaban: [],
  });
  const app = Fastify();
  try {
    await app.register(studentExamRoutes,{pool:{},waiting:{claim:async(_exam,_student,_token,start)=>start({tokenHash:'dummy',sequence:1})}});
    const csrf = 'c'.repeat(32);
    const response = await app.inject({
      method: 'POST', url: '/api/student/exams/1/start',
      headers: { authorization: `Bearer ${issueToken({ sub: 1, role: 'STUDENT', csrf, exp: Math.floor(Date.now() / 1000) + 60 })}`, 'x-csrf-token': csrf },
      payload: {},
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['cache-control'], 'no-store');
    const body = response.json();
    assert.deepEqual(Object.keys(body.soal[0]).sort(), ['id', 'opsi', 'pertanyaan', 'poin', 'tipe']);
    assert.deepEqual(Object.keys(body.soal[0].opsi[0]).sort(), ['key', 'text']);
    assert.deepEqual(Object.keys(body.exam).sort(), ['id', 'nama_ujian']);
    assert.equal(/correct_answer|kunci|pembahasan|option_mapping/i.test(response.body), false);
  } finally {
    StudentExamService.prototype.start = originalStart;
    await app.close();
  }
});

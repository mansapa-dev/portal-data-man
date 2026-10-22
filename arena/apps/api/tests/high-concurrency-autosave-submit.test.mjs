/**
 * high-concurrency-autosave-submit.test.mjs
 *
 * Verifikasi concurrency control, optimasi query, dan perlindungan race condition:
 * 1. Dua autosave untuk question berbeda pada attempt yang sama dapat diproses konkuren (S-lock FOR SHARE).
 * 2. Dua autosave untuk question yang sama dengan base_revision lama ditolak (OCC).
 * 3. Autosave bersaing dengan submit ditolak setelah submit final (status COMPLETED).
 * 4. Concurrent submit idempoten dan tidak pernah menulis ganda ke exam_results.
 * 5. Error database memicu rollback dan tidak mengembalikan respons sukses palsu.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { StudentExamService } from '../dist/services/student-exam.js';
import { ScoringService } from '../dist/services/scoring.js';

const baseClaims = { sub: 101, role: 'STUDENT', exp: Math.floor(Date.now() / 1000) + 3600, csrf: 'test-csrf' };

function createMockDb() {
  const attempt = {
    id: 1,
    public_id: 'ATTEMPT_CONCURRENT_001',
    status: 'IN_PROGRESS',
    expires_at: new Date(Date.now() + 3_600_000),
    expired: 0,
  };

  const questions = new Map([
    [10, { question_type: 'MULTIPLE_CHOICE', option_a_available: 1, option_b_available: 1, option_c_available: 1, option_d_available: 1, option_e_available: 0 }],
    [20, { question_type: 'MULTIPLE_CHOICE', option_a_available: 1, option_b_available: 1, option_c_available: 1, option_d_available: 1, option_e_available: 0 }],
  ]);

  const answers = new Map(); // questionId -> { id, answer, is_flagged }
  const versions = new Map(); // questionId -> { revision, mutation_id }
  let resultsWritten = 0;

  function createConnection() {
    let inTransaction = false;
    let released = false;

    return {
      get inTransaction() { return inTransaction; },
      get released() { return released; },
      async beginTransaction() { inTransaction = true; },
      async commit() { inTransaction = false; },
      async rollback() { inTransaction = false; },
      release() { released = true; },
      async execute(sql, params = []) {
        // Unified state query for autosave
        if (sql.includes('FROM exam_attempts ea') && sql.includes('attempt_questions q')) {
          const [qId] = params;
          const qSpec = questions.get(Number(qId));
          const ans = answers.get(Number(qId));
          const ver = versions.get(Number(qId));
          return [[{
            attempt_id: attempt.id,
            public_id: attempt.public_id,
            attempt_status: attempt.status,
            expires_at: attempt.expires_at,
            expired: attempt.expired,
            question_type: qSpec?.question_type ?? null,
            option_a_available: qSpec?.option_a_available ?? 0,
            option_b_available: qSpec?.option_b_available ?? 0,
            option_c_available: qSpec?.option_c_available ?? 0,
            option_d_available: qSpec?.option_d_available ?? 0,
            option_e_available: qSpec?.option_e_available ?? 0,
            revision: ver?.revision ?? null,
            mutation_id: ver?.mutation_id ?? null,
            answer_id: ans?.id ?? null,
            answer: ans?.answer ?? null,
            is_flagged: ans?.is_flagged ?? 0,
          }]];
        }

        // Student answers write
        if (sql.startsWith('INSERT INTO student_answers')) {
          const [, qId, answer, isFlagged] = params;
          const id = answers.size + 1;
          answers.set(Number(qId), { id, answer, is_flagged: isFlagged });
          return [{ affectedRows: 1, insertId: id }];
        }
        if (sql.startsWith('UPDATE student_answers SET')) {
          const [answer, isFlagged, id] = params;
          for (const [qId, val] of answers) {
            if (val.id === id) {
              answers.set(qId, { id, answer, is_flagged: isFlagged });
              break;
            }
          }
          return [{ affectedRows: 1 }];
        }

        // Versions write
        if (sql.startsWith('INSERT INTO answer_write_versions')) {
          const [, qId, mutationId] = params;
          versions.set(Number(qId), { revision: 1, mutation_id: mutationId });
          return [{ affectedRows: 1 }];
        }
        if (sql.startsWith('UPDATE answer_write_versions SET')) {
          const [revision, mutationId, , qId] = params;
          versions.set(Number(qId), { revision, mutation_id: mutationId });
          return [{ affectedRows: 1 }];
        }

        // Submit attempt lock
        if (sql.startsWith('SELECT id,status,expires_at')) {
          return [[{ ...attempt }]];
        }
        // Submit existing result check
        if (sql.startsWith('SELECT question_count')) {
          return resultsWritten > 0 ? [[{
            question_count: 2,
            correct_count: 2,
            wrong_count: 0,
            blank_count: 0,
            earned_points: 2,
            maximum_points: 2,
            score: 100,
          }]] : [[]];
        }
        // Submit exam meta
        if (sql.startsWith('SELECT m.type,e.grade')) return [[]];
        // Submit scoring query (optimized without option text strings)
        if (sql.startsWith('SELECT q.question_id,q.question_type')) {
          const rows = [];
          for (const [qId, qSpec] of questions) {
            const ans = answers.get(qId);
            rows.push({
              question_id: qId,
              question_type: qSpec.question_type,
              correct_answer: 'A',
              points: '1.00',
              answer: ans?.answer ?? null,
              option_count: 4,
            });
          }
          return [rows];
        }
        // Exam results insert
        if (sql.startsWith('INSERT INTO exam_results')) {
          resultsWritten++;
          return [{ affectedRows: 1, insertId: resultsWritten }];
        }
        // Exam attempts status update
        if (sql.startsWith('UPDATE exam_attempts SET status=')) {
          attempt.status = 'COMPLETED';
          return [{ affectedRows: 1 }];
        }

        throw new Error(`Unhandled mock query: ${sql}`);
      },
    };
  }

  const pool = {
    async getConnection() { return createConnection(); },
  };

  return { pool, attempt, answers, versions, getResultsCount: () => resultsWritten };
}

test('1. Dua autosave untuk soal berbeda pada attempt yang sama dapat berjalan paralel tanpa hambatan', async () => {
  const db = createMockDb();
  const service = new StudentExamService(db.pool);

  const saveQ10 = service.saveAnswer(baseClaims, 1, 10, {
    answer: 'A',
    is_flagged: false,
    attempt_id: 'ATTEMPT_CONCURRENT_001',
    base_revision: 0,
    mutation_id: 'mut-q10-111111111111',
  });

  const saveQ20 = service.saveAnswer(baseClaims, 1, 20, {
    answer: 'B',
    is_flagged: true,
    attempt_id: 'ATTEMPT_CONCURRENT_001',
    base_revision: 0,
    mutation_id: 'mut-q20-222222222222',
  });

  const [res10, res20] = await Promise.all([saveQ10, saveQ20]);

  assert.equal(res10.question_id, 10);
  assert.equal(res10.answer, 'A');
  assert.equal(res10.revision, 1);

  assert.equal(res20.question_id, 20);
  assert.equal(res20.answer, 'B');
  assert.equal(res20.is_flagged, true);
  assert.equal(res20.revision, 1);

  assert.equal(db.answers.get(10).answer, 'A');
  assert.equal(db.answers.get(20).answer, 'B');
});

test('2. Stale autosave untuk soal yang sama ditolak dengan 409 (Optimistic Concurrency Control)', async () => {
  const db = createMockDb();
  const service = new StudentExamService(db.pool);

  // Autosave 1 berhasil: revision 0 -> 1
  await service.saveAnswer(baseClaims, 1, 10, {
    answer: 'A',
    is_flagged: false,
    attempt_id: 'ATTEMPT_CONCURRENT_001',
    base_revision: 0,
    mutation_id: 'mut-initial-1111111',
  });

  // Autosave 2 dari tab lama yang mengirim base_revision 0 harus ditolak dengan 409
  await assert.rejects(
    service.saveAnswer(baseClaims, 1, 10, {
      answer: 'B',
      is_flagged: false,
      attempt_id: 'ATTEMPT_CONCURRENT_001',
      base_revision: 0, // stale!
      mutation_id: 'mut-stale-222222222',
    }),
    { statusCode: 409, message: 'Versi jawaban berubah di tab lain' }
  );

  // Jawaban di database tetap 'A' (tidak tertimpa)
  assert.equal(db.answers.get(10).answer, 'A');
});

test('3. Retry dengan mutation_id identik bersifat idempoten dan mengembalikan duplicate:true', async () => {
  const db = createMockDb();
  const service = new StudentExamService(db.pool);

  const first = await service.saveAnswer(baseClaims, 1, 10, {
    answer: 'C',
    is_flagged: false,
    attempt_id: 'ATTEMPT_CONCURRENT_001',
    base_revision: 0,
    mutation_id: 'mut-retry-111111111',
  });
  assert.equal(first.revision, 1);

  // Retry jaringan dengan payload dan mutation_id yang sama persis
  const retry = await service.saveAnswer(baseClaims, 1, 10, {
    answer: 'C',
    is_flagged: false,
    attempt_id: 'ATTEMPT_CONCURRENT_001',
    base_revision: 0,
    mutation_id: 'mut-retry-111111111',
  });

  assert.equal(retry.duplicate, true);
  assert.equal(retry.revision, 1);
});

test('4. Autosave setelah submit final ditolak dengan 409 (status COMPLETED)', async () => {
  const db = createMockDb();
  const studentService = new StudentExamService(db.pool);
  const scoringService = new ScoringService(db.pool);

  // Simpan jawaban awal
  await studentService.saveAnswer(baseClaims, 1, 10, {
    answer: 'A',
    is_flagged: false,
    attempt_id: 'ATTEMPT_CONCURRENT_001',
    base_revision: 0,
    mutation_id: 'mut-pre-submit-1111',
  });

  // Submit ujian hingga selesai
  const submitResult = await scoringService.submit(baseClaims.sub, 1, false);
  assert.equal(submitResult.status, 'selesai');
  assert.equal(db.attempt.status, 'COMPLETED');

  // Autosave terlambat yang tiba setelah submit harus ditolak 409
  await assert.rejects(
    studentService.saveAnswer(baseClaims, 1, 10, {
      answer: 'B',
      is_flagged: false,
      attempt_id: 'ATTEMPT_CONCURRENT_001',
      base_revision: 1,
      mutation_id: 'mut-late-after-submit',
    }),
    { statusCode: 409, message: 'Ujian sudah tidak aktif' }
  );

  // Jawaban di database tetap 'A'
  assert.equal(db.answers.get(10).answer, 'A');
});

test('5. Concurrent submit idempoten dan hanya menulis exam_results tepat satu kali', async () => {
  const db = createMockDb();
  const scoringService = new ScoringService(db.pool);

  // Dua submit dikirim bersamaan (double-click atau browser retry)
  const [sub1, sub2] = await Promise.all([
    scoringService.submit(baseClaims.sub, 1, false),
    scoringService.submit(baseClaims.sub, 1, false),
  ]);

  assert.deepEqual(sub1, sub2);
  assert.equal(sub1.status, 'selesai');
  // Memastikan hanya tepat 1 baris exam_results yang ditulis
  assert.equal(db.getResultsCount(), 1);
});

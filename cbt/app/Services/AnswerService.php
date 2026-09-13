<?php
declare(strict_types=1);
namespace Cbt\Services;
use Cbt\Core\Database;
use Cbt\Exceptions\DomainException;
use Cbt\Repositories\AttemptRepository;
final class AnswerService
{
 public function __construct(private Database$db,private AttemptRepository$attempts){}
 public function save(int $studentId, int $examId, int $questionId, ?string $answer, bool $flagged, string $attemptId, int $revision, string $mutationId): array
 {
  if ($revision < 0 || !preg_match('/^[A-Za-z0-9_-]{16,100}$/', $mutationId)) throw new DomainException('Versi penyimpanan tidak valid. Muat ulang halaman ujian.', 422);
  return $this->db->transaction(function () use ($studentId, $examId, $questionId, $answer, $flagged, $attemptId, $revision, $mutationId) {
   $attempt = $this->attempts->find($studentId, $examId, true) ?? throw new DomainException('Sesi ujian tidak ditemukan.', 404);
   if (!hash_equals($attempt['public_id'], $attemptId)) throw new DomainException('Antrean berasal dari sesi ujian berbeda.', 409);
   $answer = $answer === null || $answer === '' ? null : strtoupper($answer);
   if ($answer !== null && !in_array($answer, ['A', 'B', 'C', 'D', 'E'], true)) throw new DomainException('Jawaban tidak valid.', 422);
   if (!in_array($questionId, array_map('intval', json_decode($attempt['question_order'], true, 512, JSON_THROW_ON_ERROR)), true)) throw new DomainException('Soal tidak termasuk sesi ujian ini.', 404);
   $statement = $this->db->pdo()->prepare('SELECT v.revision,v.mutation_id,a.answer,a.is_flagged FROM answer_write_versions v JOIN student_answers a ON a.attempt_id=v.attempt_id AND a.question_id=v.question_id WHERE v.attempt_id=:attempt AND v.question_id=:question');
   $statement->execute(['attempt' => $attempt['id'], 'question' => $questionId]);
   $current = $statement->fetch();
   $currentRevision = $current ? (int)$current['revision'] : 0;
   // Retrying a confirmed write after the deadline acknowledges it without mutation.
   if ($current && hash_equals($current['mutation_id'], $mutationId)) {
    if ($current['answer'] !== $answer || (bool)$current['is_flagged'] !== $flagged) throw new DomainException('Identitas pengiriman telah digunakan untuk jawaban berbeda.', 409);
    return ['question_id' => $questionId, 'revision' => $currentRevision, 'duplicate' => true];
   }
   if ($attempt['status'] !== 'IN_PROGRESS') throw new DomainException('Ujian sudah tidak aktif.', 409);
   if (strtotime($attempt['expires_at'].' UTC') <= time()) throw new DomainException('Waktu ujian telah habis. Jawaban baru tidak dapat diterima.', 409);
   if ($revision !== $currentRevision) throw new DomainException('Jawaban berubah di tab atau perangkat lain. Tutup tab lain dan hubungi pengawas; antrean lokal tetap disimpan.', 409);
   $check = $this->db->pdo()->prepare('SELECT option_a,option_b,option_c,option_d,option_e FROM attempt_questions WHERE question_id=:question AND attempt_id=:attempt');
   $check->execute(['question' => $questionId, 'attempt' => $attempt['id']]);
   $question = $check->fetch();
   if (!$question) throw new DomainException('Soal tidak ditemukan.', 404);
   if ($answer !== null && ($question['option_'.strtolower($answer)] === null || $question['option_'.strtolower($answer)] === '')) throw new DomainException('Pilihan jawaban tidak tersedia.', 422);
   $this->db->pdo()->prepare('INSERT INTO student_answers(attempt_id,question_id,answer,is_flagged,answered_at) VALUES(:attempt,:question,:answer,:flagged,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE answer=VALUES(answer),is_flagged=VALUES(is_flagged),answered_at=UTC_TIMESTAMP(3)')->execute(['attempt' => $attempt['id'], 'question' => $questionId, 'answer' => $answer, 'flagged' => (int)$flagged]);
   $this->db->pdo()->prepare('INSERT INTO answer_write_versions(attempt_id,question_id,revision,mutation_id) VALUES(:attempt,:question,:revision,:mutation) ON DUPLICATE KEY UPDATE revision=VALUES(revision),mutation_id=VALUES(mutation_id)')->execute(['attempt' => $attempt['id'], 'question' => $questionId, 'revision' => $currentRevision + 1, 'mutation' => $mutationId]);
   return ['question_id' => $questionId, 'answer' => $answer, 'is_flagged' => $flagged, 'revision' => $currentRevision + 1, 'saved_at' => gmdate(DATE_ATOM)];
  });
 }
}

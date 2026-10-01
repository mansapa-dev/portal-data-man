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
   $statement = $this->db->pdo()->prepare('SELECT q.question_type,q.option_a,q.option_b,q.option_c,q.option_d,q.option_e,v.revision,v.mutation_id,a.id answer_id,a.answer,a.is_flagged FROM attempt_questions q LEFT JOIN answer_write_versions v ON v.attempt_id=q.attempt_id AND v.question_id=q.question_id LEFT JOIN student_answers a ON a.attempt_id=q.attempt_id AND a.question_id=q.question_id WHERE q.attempt_id=:attempt AND q.question_id=:question');
   $statement->execute(['attempt' => $attempt['id'], 'question' => $questionId]);
   $question = $statement->fetch();
   if (!$question) throw new DomainException('Soal tidak ditemukan.', 404);
   $type=(string)($question['question_type']??'MULTIPLE_CHOICE');
   $answer=$answer===null||trim($answer)===''?null:trim($answer);
   if($answer!==null&&$type==='SHORT_ANSWER'){
    if(mb_strlen($answer)>500)throw new DomainException('Jawaban isian terlalu panjang.',422);
   }elseif($answer!==null){
    $letters=array_values(array_unique(array_filter(explode(',',strtoupper($answer)))));sort($letters);
    if(!$letters||($type==='MULTIPLE_CHOICE'&&count($letters)!==1))throw new DomainException('Jawaban tidak valid.',422);
    foreach($letters as$letter)if(!in_array($letter,['A','B','C','D','E'],true)||empty($question['option_'.strtolower($letter)]))throw new DomainException('Pilihan jawaban tidak tersedia.',422);
    $answer=implode(',',$letters);
   }
   $current = $question['revision'] !== null && $question['mutation_id'] !== null ? $question : null;
   $currentRevision = $current ? (int)$current['revision'] : 0;
   if ($current && hash_equals($current['mutation_id'], $mutationId)) {
    if ($current['answer'] !== $answer || (bool)$current['is_flagged'] !== $flagged) throw new DomainException('Identitas pengiriman telah digunakan untuk jawaban berbeda.', 409);
    return ['question_id' => $questionId, 'revision' => $currentRevision, 'duplicate' => true];
   }
   if ($attempt['status'] !== 'IN_PROGRESS') throw new DomainException('Ujian sudah tidak aktif.', 409);
   if (strtotime($attempt['expires_at'].' UTC') <= time()) throw new DomainException('Waktu ujian telah habis. Jawaban baru tidak dapat diterima.', 409);
   if ($revision !== $currentRevision) throw new DomainException('Jawaban berubah di tab atau perangkat lain. Tutup tab lain dan hubungi pengawas; antrean lokal tetap disimpan.', 409);
   // The attempt lock serializes writers and submit. Update an existing row
   // by PRIMARY KEY rather than entering the duplicate-secondary-key insert path.
   if ($question['answer_id'] !== null) {
    $this->db->pdo()->prepare('UPDATE student_answers SET answer=:answer,is_flagged=:flagged,answered_at=UTC_TIMESTAMP(3) WHERE id=:id')->execute(['id'=>$question['answer_id'],'answer'=>$answer,'flagged'=>(int)$flagged]);
   } else {
    $this->db->pdo()->prepare('INSERT INTO student_answers(attempt_id,question_id,answer,is_flagged,answered_at) VALUES(:attempt,:question,:answer,:flagged,UTC_TIMESTAMP(3))')->execute(['attempt'=>$attempt['id'],'question'=>$questionId,'answer'=>$answer,'flagged'=>(int)$flagged]);
   }
   $this->db->pdo()->prepare('INSERT INTO answer_write_versions(attempt_id,question_id,revision,mutation_id) VALUES(:attempt,:question,:revision,:mutation) ON DUPLICATE KEY UPDATE revision=VALUES(revision),mutation_id=VALUES(mutation_id)')->execute(['attempt' => $attempt['id'], 'question' => $questionId, 'revision' => $currentRevision + 1, 'mutation' => $mutationId]);
   return ['question_id' => $questionId, 'answer' => $answer, 'is_flagged' => $flagged, 'revision' => $currentRevision + 1, 'saved_at' => gmdate(DATE_ATOM)];
  });
 }
}

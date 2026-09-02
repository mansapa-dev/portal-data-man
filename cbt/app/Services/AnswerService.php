<?php
declare(strict_types=1);
namespace Cbt\Services;
use Cbt\Core\Database;
use Cbt\Exceptions\DomainException;
use Cbt\Repositories\AttemptRepository;
final class AnswerService
{
 public function __construct(private Database$db,private AttemptRepository$attempts){}
 public function save(int$studentId,int$examId,int$questionId,?string$answer,bool$flagged):array{return$this->db->transaction(function()use($studentId,$examId,$questionId,$answer,$flagged){$attempt=$this->attempts->find($studentId,$examId,true)??throw new DomainException('Sesi ujian tidak ditemukan.',404);if($attempt['status']!=='IN_PROGRESS')throw new DomainException('Ujian sudah tidak aktif.',409);if(strtotime($attempt['expires_at'].' UTC')<=time())throw new DomainException('Waktu ujian telah habis.',409);$answer=$answer===null||$answer===''?null:strtoupper($answer);if($answer!==null&&!in_array($answer,['A','B','C','D','E'],true))throw new DomainException('Jawaban tidak valid.',422);$check=$this->db->pdo()->prepare("SELECT id FROM questions WHERE id=:question AND exam_id=:exam AND status='ACTIVE'");$check->execute(['question'=>$questionId,'exam'=>$examId]);if(!$check->fetch())throw new DomainException('Soal tidak ditemukan.',404);$sql='INSERT INTO student_answers(attempt_id,question_id,answer,is_flagged,answered_at) VALUES(:attempt,:question,:answer,:flagged,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE answer=VALUES(answer),is_flagged=VALUES(is_flagged),answered_at=UTC_TIMESTAMP(3)';$this->db->pdo()->prepare($sql)->execute(['attempt'=>$attempt['id'],'question'=>$questionId,'answer'=>$answer,'flagged'=>(int)$flagged]);return['question_id'=>$questionId,'answer'=>$answer,'is_flagged'=>$flagged,'saved_at'=>gmdate(DATE_ATOM)];});}
}

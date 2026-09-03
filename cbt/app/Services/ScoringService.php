<?php
declare(strict_types=1);
namespace Cbt\Services;
use Cbt\Core\Database;
use Cbt\Exceptions\DomainException;
use Cbt\Repositories\AttemptRepository;
final class ScoringService
{
 public function __construct(private Database$db,private AttemptRepository$attempts){}

 public function submit(int$studentId,int$examId):array
 {
  return$this->db->transaction(function()use($studentId,$examId){
   $attempt=$this->attempts->find($studentId,$examId,true)??throw new DomainException('Sesi ujian tidak ditemukan.',404);
   $existing=$this->attempts->result((int)$attempt['id']);
   if($existing)return$this->format($existing);
   if(!in_array($attempt['status'],['IN_PROGRESS','TERMINATED'],true))throw new DomainException('Ujian tidak dapat disubmit.',409);

   $sql='SELECT q.id,q.correct_answer,q.points,a.answer FROM questions q LEFT JOIN student_answers a ON a.question_id=q.id AND a.attempt_id=:attempt WHERE q.exam_id=:exam AND q.status=\'ACTIVE\'';
   $statement=$this->db->pdo()->prepare($sql);
   $statement->execute(['attempt'=>$attempt['id'],'exam'=>$examId]);
   $rows=$statement->fetchAll();
   if(!$rows)throw new DomainException('Soal ujian tidak ditemukan.',409);

   $correct=$wrong=$blank=0;$earned=$maximum=0.0;
   foreach($rows as$row){
    $maximum+=(float)$row['points'];
    if($row['answer']===null){$blank++;}
    elseif(hash_equals($row['correct_answer'],$row['answer'])){$correct++;$earned+=(float)$row['points'];}
    else{$wrong++;}
   }
   $score=$maximum>0?round($earned/$maximum*100,2):0.0;

   // --- Cek apakah ujian ini adalah REMEDIAL, lalu terapkan cap nilai ---
   $isRemedial=false;$scoreCap=null;
   try{
    $metaStmt=$this->db->pdo()->prepare("SELECT m.type,e.grade FROM exam_follow_up_meta m JOIN exams e ON e.id=m.exam_id WHERE m.exam_id=:exam LIMIT 1");
    $metaStmt->execute(['exam'=>$examId]);
    $meta=$metaStmt->fetch();
    if($meta&&$meta['type']==='REMEDIAL'){
     $isRemedial=true;
     $grade=strtoupper(trim((string)$meta['grade']));
     $capKey='remedial_score_cap_'.$grade;
     $capStmt=$this->db->pdo()->prepare('SELECT value FROM cbt_settings WHERE key_name=:k LIMIT 1');
     $capStmt->execute(['k'=>$capKey]);
     $capVal=$capStmt->fetchColumn();
     $scoreCap=$capVal!==false?(float)$capVal:75.0;
     if($score>$scoreCap)$score=round($scoreCap,2);
    }
   }catch(\Throwable){}
   // --- End REMEDIAL cap ---

   $insert=$this->db->pdo()->prepare('INSERT INTO exam_results(attempt_id,question_count,correct_count,wrong_count,blank_count,earned_points,maximum_points,score) VALUES(:attempt,:total,:correct,:wrong,:blank,:earned,:maximum,:score)');
   $insert->execute(['attempt'=>$attempt['id'],'total'=>count($rows),'correct'=>$correct,'wrong'=>$wrong,'blank'=>$blank,'earned'=>$earned,'maximum'=>$maximum,'score'=>$score]);
   $this->db->pdo()->prepare("UPDATE exam_attempts SET status=IF(status='TERMINATED','TERMINATED','COMPLETED'),completed_at=UTC_TIMESTAMP(3) WHERE id=:id")->execute(['id'=>$attempt['id']]);

   return['jumlah_soal'=>count($rows),'benar'=>$correct,'salah'=>$wrong,'kosong'=>$blank,'total_poin'=>$earned,'nilai'=>$score,'is_remedial'=>$isRemedial,'score_cap'=>$scoreCap,'status'=>'selesai'];
  });
 }

 private function format(array$r):array
 {
  // Cek is_remedial & score_cap dari meta jika result sudah ada
  $isRemedial=false;$scoreCap=null;
  try{
   $attemptId=(int)$r['attempt_id'];
   $examStmt=$this->db->pdo()->prepare('SELECT exam_id FROM exam_attempts WHERE id=:id LIMIT 1');
   $examStmt->execute(['id'=>$attemptId]);$examId=(int)$examStmt->fetchColumn();
   if($examId){
    $metaStmt=$this->db->pdo()->prepare("SELECT m.type,e.grade FROM exam_follow_up_meta m JOIN exams e ON e.id=m.exam_id WHERE m.exam_id=:exam LIMIT 1");
    $metaStmt->execute(['exam'=>$examId]);$meta=$metaStmt->fetch();
    if($meta&&$meta['type']==='REMEDIAL'){
     $isRemedial=true;
     $grade=strtoupper(trim((string)$meta['grade']));
     $capKey='remedial_score_cap_'.$grade;
     $capStmt=$this->db->pdo()->prepare('SELECT value FROM cbt_settings WHERE key_name=:k LIMIT 1');
     $capStmt->execute(['k'=>$capKey]);$capVal=$capStmt->fetchColumn();
     $scoreCap=$capVal!==false?(float)$capVal:75.0;
    }
   }
  }catch(\Throwable){}
  return['jumlah_soal'=>(int)$r['question_count'],'benar'=>(int)$r['correct_count'],'salah'=>(int)$r['wrong_count'],'kosong'=>(int)$r['blank_count'],'total_poin'=>(float)$r['earned_points'],'nilai'=>(float)$r['score'],'is_remedial'=>$isRemedial,'score_cap'=>$scoreCap,'status'=>'selesai'];
 }

 public function review(int$studentId,int$examId):array
 {
  $attempt=$this->attempts->find($studentId,$examId)??throw new DomainException('Sesi ujian tidak ditemukan.',404);
  if(!in_array($attempt['status'],['COMPLETED','TERMINATED'],true))throw new DomainException('Review hanya tersedia setelah ujian selesai.',403);
  $sql='SELECT q.id,q.question_text,q.correct_answer,a.answer FROM questions q LEFT JOIN student_answers a ON a.question_id=q.id AND a.attempt_id=:attempt WHERE q.exam_id=:exam AND q.status=\'ACTIVE\'';
  $s=$this->db->pdo()->prepare($sql);$s->execute(['attempt'=>$attempt['id'],'exam'=>$examId]);$rows=$s->fetchAll();
  return['soal'=>array_map(fn($r)=>['id'=>(int)$r['id'],'pertanyaan'=>$r['question_text'],'jawaban_benar'=>$r['correct_answer']],$rows),'jawaban'=>array_map(fn($r)=>['soal_id'=>(int)$r['id'],'jawaban'=>$r['answer']],$rows)];
 }
}

<?php
declare(strict_types=1);
namespace Cbt\Repositories;
use PDO;
final class AdminStudentRepository
{
 public function __construct(private PDO$db){}
 public function all():array
 {
  $sql="SELECT s.id,s.nisn,s.name_snapshot,s.class_snapshot,s.grade_snapshot,s.academic_year_snapshot,s.is_active,s.last_synced_at,s.pin_encrypted,
          (s.pin_hash IS NOT NULL) pin_is_set,COALESCE(active.active_attempts,0) active_attempts,latest.status latest_attempt_status,
          reset_attempt.exam_id reset_exam_id,reset_exam.name reset_exam_name,CASE
          WHEN COALESCE(active.active_attempts,0)>0 THEN 'berlangsung'
          WHEN latest.status='TERMINATED' THEN 'dihentikan'
          WHEN latest.status='COMPLETED' THEN 'selesai'
          ELSE 'belum'
        END ujian_status
        FROM students s
        LEFT JOIN (SELECT student_id,COUNT(*) active_attempts FROM exam_attempts WHERE status='IN_PROGRESS' AND expires_at>UTC_TIMESTAMP(3) GROUP BY student_id) active ON active.student_id=s.id
        LEFT JOIN (SELECT student_id,SUBSTRING_INDEX(GROUP_CONCAT(status ORDER BY updated_at DESC,id DESC),',',1) status FROM exam_attempts GROUP BY student_id) latest ON latest.student_id=s.id
        LEFT JOIN (SELECT student_id,MAX(id) id FROM exam_attempts WHERE status='TERMINATED' AND violation_count>=3 GROUP BY student_id) latest_reset ON latest_reset.student_id=s.id
        LEFT JOIN exam_attempts reset_attempt ON reset_attempt.id=latest_reset.id
        LEFT JOIN exams reset_exam ON reset_exam.id=reset_attempt.exam_id
        WHERE s.is_active=1 ORDER BY s.id DESC";
  return$this->db->query($sql)->fetchAll();
 }
 public function find(int$id):?array{$s=$this->db->prepare('SELECT * FROM students WHERE id=:id');$s->execute(['id'=>$id]);return$s->fetch()?:null;}
 public function setPin(int$id,string$hash,string$encrypted):void{$s=$this->db->prepare('UPDATE students SET pin_hash=:hash,pin_encrypted=:encrypted WHERE id=:id');$s->execute(compact('hash','encrypted','id'));}
 public function pinBatch(?string$grade,?string$class,int$afterId,int$limit):array{$where=['is_active=1','id>:after'];$params=['after'=>$afterId];if($grade&&$grade!=='ALL'){$where[]='UPPER(grade_snapshot)=UPPER(:grade)';$params['grade']=$grade;}if($class&&$class!=='ALL'){$where[]='UPPER(class_snapshot)=UPPER(:class)';$params['class']=$class;}$limit=max(1,min(50,$limit));$sql='SELECT id FROM students WHERE '.implode(' AND ',$where).' ORDER BY id ASC LIMIT '.$limit;$s=$this->db->prepare($sql);$s->execute($params);return array_map('intval',$s->fetchAll(PDO::FETCH_COLUMN));}
 public function pinTargetCount(?string$grade,?string$class):int{$where=['is_active=1'];$params=[];if($grade&&$grade!=='ALL'){$where[]='UPPER(grade_snapshot)=UPPER(:grade)';$params['grade']=$grade;}if($class&&$class!=='ALL'){$where[]='UPPER(class_snapshot)=UPPER(:class)';$params['class']=$class;}$s=$this->db->prepare('SELECT COUNT(*) FROM students WHERE '.implode(' AND ',$where));$s->execute($params);return(int)$s->fetchColumn();}
 public function resetAttempts(int$id):void{$s=$this->db->prepare("UPDATE exam_attempts SET status='EXPIRED' WHERE student_id=:id AND status IN ('IN_PROGRESS','TERMINATED')");$s->execute(['id'=>$id]);}
}

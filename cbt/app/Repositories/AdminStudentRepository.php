<?php
declare(strict_types=1);
namespace Cbt\Repositories;
use PDO;
final class AdminStudentRepository
{
 public function __construct(private PDO$db){}
 public function all():array
 {
  $sql="SELECT listed.*,CASE
          WHEN listed.active_attempts>0 THEN 'berlangsung'
          WHEN listed.latest_attempt_status='TERMINATED' THEN 'dihentikan'
          WHEN listed.latest_attempt_status='COMPLETED' THEN 'selesai'
          ELSE 'belum'
        END ujian_status
        FROM (
          SELECT s.id,s.nisn,s.name_snapshot,s.class_snapshot,s.grade_snapshot,s.academic_year_snapshot,s.is_active,s.last_synced_at,s.pin_encrypted,
                 (s.pin_hash IS NOT NULL) pin_is_set,
                 (SELECT COUNT(*) FROM exam_attempts active_attempt WHERE active_attempt.student_id=s.id AND active_attempt.status='IN_PROGRESS' AND active_attempt.expires_at>UTC_TIMESTAMP(3)) active_attempts,
                 (SELECT latest.status FROM exam_attempts latest WHERE latest.student_id=s.id ORDER BY latest.updated_at DESC,latest.id DESC LIMIT 1) latest_attempt_status
          FROM students s WHERE s.is_active=1
        ) listed
        ORDER BY listed.id DESC";
  return$this->db->query($sql)->fetchAll();
 }
 public function find(int$id):?array{$s=$this->db->prepare('SELECT * FROM students WHERE id=:id');$s->execute(['id'=>$id]);return$s->fetch()?:null;}
 public function setPin(int$id,string$hash,string$encrypted):void{$s=$this->db->prepare('UPDATE students SET pin_hash=:hash,pin_encrypted=:encrypted WHERE id=:id');$s->execute(compact('hash','encrypted','id'));}
 public function pinBatch(?string$grade,?string$class,int$afterId,int$limit):array{$where=['is_active=1','id>:after'];$params=['after'=>$afterId];if($grade&&$grade!=='ALL'){$where[]='UPPER(grade_snapshot)=UPPER(:grade)';$params['grade']=$grade;}if($class&&$class!=='ALL'){$where[]='UPPER(class_snapshot)=UPPER(:class)';$params['class']=$class;}$limit=max(1,min(50,$limit));$sql='SELECT id FROM students WHERE '.implode(' AND ',$where).' ORDER BY id ASC LIMIT '.$limit;$s=$this->db->prepare($sql);$s->execute($params);return array_map('intval',$s->fetchAll(PDO::FETCH_COLUMN));}
 public function pinTargetCount(?string$grade,?string$class):int{$where=['is_active=1'];$params=[];if($grade&&$grade!=='ALL'){$where[]='UPPER(grade_snapshot)=UPPER(:grade)';$params['grade']=$grade;}if($class&&$class!=='ALL'){$where[]='UPPER(class_snapshot)=UPPER(:class)';$params['class']=$class;}$s=$this->db->prepare('SELECT COUNT(*) FROM students WHERE '.implode(' AND ',$where));$s->execute($params);return(int)$s->fetchColumn();}
 public function resetAttempts(int$id):void{$s=$this->db->prepare("UPDATE exam_attempts SET status='EXPIRED' WHERE student_id=:id AND status IN ('IN_PROGRESS','TERMINATED')");$s->execute(['id'=>$id]);}
}

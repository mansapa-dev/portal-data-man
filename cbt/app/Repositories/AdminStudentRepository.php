<?php
declare(strict_types=1);
namespace Cbt\Repositories;
use PDO;
final class AdminStudentRepository
{
 public function __construct(private PDO$db){}
 public function all():array{$sql="SELECT s.*,CASE WHEN EXISTS(SELECT 1 FROM exam_attempts a WHERE a.student_id=s.id AND a.status='TERMINATED') THEN 'dihentikan' WHEN EXISTS(SELECT 1 FROM exam_attempts a WHERE a.student_id=s.id AND a.status='IN_PROGRESS') THEN 'berlangsung' WHEN EXISTS(SELECT 1 FROM exam_attempts a WHERE a.student_id=s.id AND a.status='COMPLETED') THEN 'selesai' ELSE 'belum' END ujian_status FROM students s ORDER BY s.id DESC";return$this->db->query($sql)->fetchAll();}
 public function find(int$id):?array{$s=$this->db->prepare('SELECT * FROM students WHERE id=:id');$s->execute(['id'=>$id]);return$s->fetch()?:null;}
 public function setPin(int$id,string$hash,string$encrypted):void{$s=$this->db->prepare('UPDATE students SET pin_hash=:hash,pin_encrypted=:encrypted WHERE id=:id');$s->execute(compact('hash','encrypted','id'));}
 public function pinBatch(?string$grade,?string$class,int$afterId,int$limit):array{$where=['is_active=1','id>:after'];$params=['after'=>$afterId];if($grade&&$grade!=='ALL'){$where[]='UPPER(grade_snapshot)=UPPER(:grade)';$params['grade']=$grade;}if($class&&$class!=='ALL'){$where[]='UPPER(class_snapshot)=UPPER(:class)';$params['class']=$class;}$limit=max(1,min(50,$limit));$sql='SELECT id FROM students WHERE '.implode(' AND ',$where).' ORDER BY id ASC LIMIT '.$limit;$s=$this->db->prepare($sql);$s->execute($params);return array_map('intval',$s->fetchAll(PDO::FETCH_COLUMN));}
 public function pinTargetCount(?string$grade,?string$class):int{$where=['is_active=1'];$params=[];if($grade&&$grade!=='ALL'){$where[]='UPPER(grade_snapshot)=UPPER(:grade)';$params['grade']=$grade;}if($class&&$class!=='ALL'){$where[]='UPPER(class_snapshot)=UPPER(:class)';$params['class']=$class;}$s=$this->db->prepare('SELECT COUNT(*) FROM students WHERE '.implode(' AND ',$where));$s->execute($params);return(int)$s->fetchColumn();}
 public function resetAttempts(int$id):void{$s=$this->db->prepare("UPDATE exam_attempts SET status='EXPIRED' WHERE student_id=:id AND status IN ('IN_PROGRESS','TERMINATED')");$s->execute(['id'=>$id]);}
}

<?php
namespace App\Application\Dashboard;
use App\Infrastructure\Database\Connection;
final class DashboardService
{
    public function __construct(private readonly Connection $database){}
    public function forUser(array $actor):array{return $actor['role']==='TEACHER'?$this->teacher($actor):$this->admin();}
    public function teacher(array $actor):array
    {
        $pdo=$this->database->pdo();$base=" FROM journals WHERE teacher_public_id=:teacher AND deleted_at IS NULL";$metrics=[];
        foreach(['today'=>"journal_date=CURDATE()",'draft'=>"status='DRAFT'",'month'=>"YEAR(journal_date)=YEAR(CURDATE()) AND MONTH(journal_date)=MONTH(CURDATE())"] as $key=>$condition){$q=$pdo->prepare('SELECT COUNT(*)'.$base.' AND '.$condition);$q->execute(['teacher'=>$actor['portal_teacher_public_id']]);$metrics[$key]=(int)$q->fetchColumn();}
        $attendance=$pdo->prepare("SELECT r.status,COUNT(*) total FROM attendance_records r JOIN attendance_sessions a ON a.id=r.attendance_session_id WHERE a.teacher_public_id=:teacher AND YEAR(a.attendance_date)=YEAR(CURDATE()) AND MONTH(a.attendance_date)=MONTH(CURDATE()) GROUP BY r.status");$attendance->execute(['teacher'=>$actor['portal_teacher_public_id']]);$stats=['PRESENT'=>0,'SICK'=>0,'PERMITTED'=>0,'ABSENT'=>0,'NOT_PARTICIPATING'=>0];foreach($attendance->fetchAll() as $row)$stats[$row['status']]=(int)$row['total'];
        $recent=$pdo->prepare("SELECT public_id AS publicId,journal_date AS journalDate,class_name_snapshot AS className,subject_name_snapshot AS subjectName,status,updated_at AS updatedAt FROM journals WHERE teacher_public_id=:teacher AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5");$recent->execute(['teacher'=>$actor['portal_teacher_public_id']]);return ['metrics'=>$metrics,'attendance'=>$stats,'recent'=>$recent->fetchAll()];
    }
    private function admin():array
    {
        $pdo=$this->database->pdo();$metrics=[];foreach(['today'=>"journal_date=CURDATE()",'draft'=>"status='DRAFT'",'month'=>"YEAR(journal_date)=YEAR(CURDATE()) AND MONTH(journal_date)=MONTH(CURDATE())"] as $key=>$condition)$metrics[$key]=(int)$pdo->query('SELECT COUNT(*) FROM journals WHERE deleted_at IS NULL AND '.$condition)->fetchColumn();$metrics['teachers']=(int)$pdo->query("SELECT COUNT(DISTINCT teacher_public_id) FROM journals WHERE YEAR(journal_date)=YEAR(CURDATE()) AND MONTH(journal_date)=MONTH(CURDATE()) AND deleted_at IS NULL")->fetchColumn();$attendance=['PRESENT'=>0,'SICK'=>0,'PERMITTED'=>0,'ABSENT'=>0,'NOT_PARTICIPATING'=>0];foreach($pdo->query("SELECT r.status,COUNT(*) total FROM attendance_records r JOIN attendance_sessions a ON a.id=r.attendance_session_id WHERE YEAR(a.attendance_date)=YEAR(CURDATE()) AND MONTH(a.attendance_date)=MONTH(CURDATE()) GROUP BY r.status")->fetchAll() as $row)$attendance[$row['status']]=(int)$row['total'];$recent=$pdo->query("SELECT public_id AS publicId,journal_date AS journalDate,class_name_snapshot AS className,subject_name_snapshot AS subjectName,status,updated_at AS updatedAt FROM journals WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5")->fetchAll();return ['metrics'=>$metrics,'attendance'=>$attendance,'recent'=>$recent];
    }
}

<?php
namespace App\Application\Attendance;

use App\Domain\Journal\LessonPeriod;
use App\Domain\Attendance\Nisn;
use App\Infrastructure\Database\Connection;
use App\Infrastructure\PortalData\PortalDataClient;
use App\Support\Ulid;
use DateTimeImmutable;
use InvalidArgumentException;
use PDO;
use RuntimeException;
use Throwable;

final class AttendanceService
{
    private const STATUSES=['PRESENT','SICK','PERMITTED','ABSENT','NOT_PARTICIPATING','UNMARKED'];
    public function __construct(private readonly Connection $database,private readonly PortalDataClient $portal){}

    public function subjects():array{return $this->database->pdo()->query("SELECT public_id AS publicId,code,name FROM subjects WHERE status='ACTIVE' AND deleted_at IS NULL ORDER BY name")->fetchAll();}

    public function create(array $input,array $actor,string $token):array
    {
        $date=DateTimeImmutable::createFromFormat('!Y-m-d',(string)($input['date']??'')); if(!$date||$date->format('Y-m-d')!==($input['date']??''))throw new InvalidArgumentException('Tanggal absensi tidak valid.');$today=new DateTimeImmutable('today');if($date>$today)throw new InvalidArgumentException('Tanggal absensi tidak boleh di masa depan.');
        $period=new LessonPeriod((int)($input['periodStart']??0),(int)($input['periodEnd']??0));
        foreach(['classPublicId','semesterPublicId','subjectPublicId'] as $field)if(!preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/',(string)($input[$field]??'')))throw new InvalidArgumentException('Referensi '.$field.' tidak valid.');
        $pdo=$this->database->pdo();$limit=(int)($pdo->query("SELECT setting_value FROM application_settings WHERE setting_key='journal_edit_hours' LIMIT 1")->fetchColumn()?:24);if($date<$today->modify('-'.$limit.' hours'))throw new InvalidArgumentException('Tanggal absensi melewati batas waktu yang diizinkan.');$subject=$pdo->prepare("SELECT id,public_id,name FROM subjects WHERE public_id=:id AND status='ACTIVE' AND deleted_at IS NULL");$subject->execute(['id'=>$input['subjectPublicId']]);$subject=$subject->fetch();if(!$subject)throw new InvalidArgumentException('Mata pelajaran aktif tidak ditemukan.');
        $reference=$this->portal->classStudents($input['classPublicId'],$token,$input['semesterPublicId']); if(empty($reference['students']))throw new InvalidArgumentException('Kelas belum memiliki siswa aktif.');
        $sessionPublicId=Ulid::generate();$pdo->beginTransaction();
        try{
            $insert=$pdo->prepare("INSERT INTO attendance_sessions(public_id,attendance_date,class_public_id,class_name_snapshot,academic_year_public_id,academic_year_snapshot,semester_public_id,semester_snapshot,teacher_public_id,teacher_name_snapshot,subject_id,subject_name_snapshot,period_start,period_end,status,created_by) VALUES(:public_id,:date,:class_id,:class_name,:year_id,:year_name,:semester_id,:semester_name,:teacher_id,:teacher_name,:subject_id,:subject_name,:period_start,:period_end,'DRAFT',:created_by)");
            $insert->execute(['public_id'=>$sessionPublicId,'date'=>$date->format('Y-m-d'),'class_id'=>$reference['class']['publicId'],'class_name'=>$reference['class']['name'],'year_id'=>$reference['academicYear']['publicId'],'year_name'=>$reference['academicYear']['name'],'semester_id'=>$reference['semester']['publicId'],'semester_name'=>$reference['semester']['type'],'teacher_id'=>$actor['portal_teacher_public_id'],'teacher_name'=>$actor['name'],'subject_id'=>$subject['id'],'subject_name'=>$subject['name'],'period_start'=>$period->start,'period_end'=>$period->end,'created_by'=>$actor['id']]);
            $sessionId=(int)$pdo->lastInsertId();$record=$pdo->prepare("INSERT INTO attendance_records(public_id,attendance_session_id,student_public_id,nisn_snapshot,student_name_snapshot,attendance_number_snapshot,status,method,marked_by) VALUES(:public_id,:session_id,:student_id,:nisn,:name,:number,'UNMARKED','SYSTEM',:marked_by)");
            foreach($reference['students'] as $student)$record->execute(['public_id'=>Ulid::generate(),'session_id'=>$sessionId,'student_id'=>$student['publicId'],'nisn'=>$student['nisn'],'name'=>$student['fullName'],'number'=>$student['attendanceNumber'],'marked_by'=>$actor['id']]);
            $this->audit($pdo,$actor,'ATTENDANCE_CREATED','AttendanceSession',$sessionPublicId,['studentCount'=>count($reference['students'])]);$pdo->commit();
        }catch(Throwable $error){$pdo->rollBack();throw $error;}
        return $this->detail($sessionPublicId,$actor);
    }

    public function detail(string $publicId,array $actor):array
    {
        $pdo=$this->database->pdo();$query=$pdo->prepare('SELECT a.public_id,a.attendance_date,a.class_public_id,a.class_name_snapshot,a.academic_year_snapshot,a.semester_snapshot,a.teacher_name_snapshot,a.subject_name_snapshot,a.period_start,a.period_end,a.status,a.finalized_at FROM attendance_sessions a WHERE a.public_id=:id AND a.teacher_public_id=:teacher LIMIT 1');$query->execute(['id'=>$publicId,'teacher'=>$actor['portal_teacher_public_id']]);$session=$query->fetch();if(!$session)throw new RuntimeException('Absensi tidak ditemukan.');
        $records=$pdo->prepare('SELECT public_id AS publicId,student_public_id AS studentPublicId,nisn_snapshot AS nisn,student_name_snapshot AS studentName,attendance_number_snapshot AS attendanceNumber,status,method,scanned_at AS scannedAt,marked_at AS markedAt,note,correction_reason AS correctionReason FROM attendance_records WHERE attendance_session_id=(SELECT id FROM attendance_sessions WHERE public_id=:id) ORDER BY attendance_number_snapshot,student_name_snapshot');$records->execute(['id'=>$publicId]);$items=$records->fetchAll();
        return ['session'=>$this->camelSession($session),'records'=>$items,'summary'=>$this->summary($items)];
    }

    public function mark(string $sessionPublicId,string $studentPublicId,string $status,?string $note,?string $reason,array $actor):array
    {
        if(!in_array($status,self::STATUSES,true))throw new InvalidArgumentException('Status kehadiran tidak valid.');$pdo=$this->database->pdo();$session=$this->ownedDraft($sessionPublicId,$actor);
        $query=$pdo->prepare('SELECT id,status FROM attendance_records WHERE attendance_session_id=:session_id AND student_public_id=:student_id LIMIT 1');$query->execute(['session_id'=>$session['id'],'student_id'=>$studentPublicId]);$record=$query->fetch();if(!$record)throw new InvalidArgumentException('Siswa bukan anggota kelas absensi ini.');if($record['status']!=='UNMARKED'&&$record['status']!==$status&&trim((string)$reason)==='')throw new InvalidArgumentException('Alasan koreksi wajib diisi.');
        $pdo->prepare("UPDATE attendance_records SET status=:status,method='MANUAL',marked_at=NOW(3),marked_by=:actor,note=:note,correction_reason=:reason WHERE id=:id")->execute(['status'=>$status,'actor'=>$actor['id'],'note'=>$note?:null,'reason'=>$reason?:null,'id'=>$record['id']]);$this->audit($pdo,$actor,'ATTENDANCE_MARKED','AttendanceSession',$sessionPublicId,['studentPublicId'=>$studentPublicId,'before'=>$record['status'],'after'=>$status]);return $this->detail($sessionPublicId,$actor);
    }

    public function markAllPresent(string $sessionPublicId,array $actor):array
    {
        $pdo=$this->database->pdo();$session=$this->ownedDraft($sessionPublicId,$actor);$pdo->prepare("UPDATE attendance_records SET status='PRESENT',method='MANUAL',marked_at=NOW(3),marked_by=:actor WHERE attendance_session_id=:id AND status='UNMARKED'")->execute(['actor'=>$actor['id'],'id'=>$session['id']]);$this->audit($pdo,$actor,'ATTENDANCE_MARK_ALL_PRESENT','AttendanceSession',$sessionPublicId,[]);return $this->detail($sessionPublicId,$actor);
    }

    public function scan(string $sessionPublicId,string $nisn,array $actor):array
    {
        $nisn=(string)new Nisn($nisn);$pdo=$this->database->pdo();$session=$this->ownedDraft($sessionPublicId,$actor);$query=$pdo->prepare('SELECT id,public_id,student_public_id,student_name_snapshot,status,method FROM attendance_records WHERE attendance_session_id=:session_id AND nisn_snapshot=:nisn LIMIT 1');$query->execute(['session_id'=>$session['id'],'nisn'=>$nisn]);$record=$query->fetch();if(!$record)throw new InvalidArgumentException('NISN bukan anggota kelas yang dipilih.');if($record['status']==='PRESENT'&&$record['method']==='BARCODE')throw new InvalidArgumentException('Siswa ini sudah berhasil dipindai.');
        $pdo->prepare("UPDATE attendance_records SET status='PRESENT',method='BARCODE',scanned_at=NOW(3),marked_at=NOW(3),marked_by=:actor WHERE id=:id")->execute(['actor'=>$actor['id'],'id'=>$record['id']]);$this->audit($pdo,$actor,'BARCODE_SCANNED','AttendanceSession',$sessionPublicId,['studentPublicId'=>$record['student_public_id']]);return ['student'=>['publicId'=>$record['student_public_id'],'name'=>$record['student_name_snapshot']],'attendance'=>$this->detail($sessionPublicId,$actor)];
    }

    public function finalize(string $sessionPublicId,array $actor):array
    {
        $pdo=$this->database->pdo();$session=$this->ownedDraft($sessionPublicId,$actor);$count=$pdo->prepare("SELECT COUNT(*) FROM attendance_records WHERE attendance_session_id=:id AND status='UNMARKED'");$count->execute(['id'=>$session['id']]);if((int)$count->fetchColumn()>0)throw new InvalidArgumentException('Semua siswa harus ditandai sebelum finalisasi.');$pdo->prepare("UPDATE attendance_sessions SET status='FINAL',finalized_at=NOW(3) WHERE id=:id")->execute(['id'=>$session['id']]);$this->audit($pdo,$actor,'ATTENDANCE_FINALIZED','AttendanceSession',$sessionPublicId,[]);return $this->detail($sessionPublicId,$actor);
    }

    private function ownedDraft(string $publicId,array $actor):array{$q=$this->database->pdo()->prepare("SELECT id FROM attendance_sessions WHERE public_id=:id AND teacher_public_id=:teacher AND status='DRAFT' LIMIT 1");$q->execute(['id'=>$publicId,'teacher'=>$actor['portal_teacher_public_id']]);$row=$q->fetch();if(!$row)throw new RuntimeException('Draft absensi tidak ditemukan atau tidak dapat diubah.');return $row;}
    private function summary(array $items):array{$summary=array_fill_keys(self::STATUSES,0);foreach($items as $item)$summary[$item['status']]++;return $summary;}
    private function camelSession(array $s):array{return ['publicId'=>$s['public_id'],'date'=>$s['attendance_date'],'classPublicId'=>$s['class_public_id'],'className'=>$s['class_name_snapshot'],'academicYear'=>$s['academic_year_snapshot'],'semester'=>$s['semester_snapshot'],'teacherName'=>$s['teacher_name_snapshot'],'subjectName'=>$s['subject_name_snapshot'],'periodStart'=>(int)$s['period_start'],'periodEnd'=>(int)$s['period_end'],'status'=>$s['status'],'finalizedAt'=>$s['finalized_at']];}
    private function audit(PDO $pdo,array $actor,string $action,string $entity,string $entityPublicId,array $metadata):void{$pdo->prepare("INSERT INTO audit_logs(public_id,actor_public_id,actor_name_snapshot,actor_role,action,entity_type,entity_public_id,metadata_json,created_at) VALUES(:public_id,:actor_id,:actor_name,:role,:action,:entity,:entity_id,:metadata,NOW(3))")->execute(['public_id'=>Ulid::generate(),'actor_id'=>$actor['public_id'],'actor_name'=>$actor['name'],'role'=>$actor['role'],'action'=>$action,'entity'=>$entity,'entity_id'=>$entityPublicId,'metadata'=>json_encode($metadata,JSON_THROW_ON_ERROR)]);}
}

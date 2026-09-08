<?php
declare(strict_types=1);
namespace Cbt\Services;

use Cbt\Core\Database;
use Cbt\Exceptions\DomainException;
use Cbt\Repositories\ExamRepository;
use Cbt\Support\Id;
use PDO;

final class SupportTicketService
{
    private const CATEGORIES=['ACCOUNT_ACCESS','EXAM_LOCKED','PIN','CONNECTION','TECHNICAL','OTHER'];
    private const STATUSES=['OPEN','IN_PROGRESS','RESOLVED','CLOSED'];

    public function __construct(private Database $db,private AttemptResetService $resets){}

    public function create(?int $sessionStudentId,array $data):array
    {
        $category=strtoupper(trim((string)($data['category']??'OTHER')));
        if(!in_array($category,self::CATEGORIES,true))throw new DomainException('Kategori bantuan tidak valid.',422);
        $message=trim((string)($data['message']??''));
        if(mb_strlen($message)<5)throw new DomainException('Jelaskan kendala minimal 5 karakter.',422);
        if(mb_strlen($message)>1000)throw new DomainException('Penjelasan kendala maksimal 1000 karakter.',422);
        $examId=(int)($data['exam_id']??0);
        $nisn=preg_replace('/\s+/','',trim((string)($data['nisn']??'')))??'';
        if(!$sessionStudentId&&!preg_match('/^\d{8,20}$/',$nisn))throw new DomainException('Masukkan NISN yang valid.',422);

        return $this->db->transaction(function(PDO $pdo)use($sessionStudentId,$category,$message,$examId,$nisn){
            if($sessionStudentId){$student=$pdo->prepare('SELECT * FROM students WHERE id=? AND is_active=1 FOR UPDATE');$student->execute([$sessionStudentId]);}
            else{$student=$pdo->prepare('SELECT * FROM students WHERE nisn=? AND is_active=1 FOR UPDATE');$student->execute([$nisn]);}
            $studentRow=$student->fetch();$studentId=(int)($studentRow['id']??0);
            if(!$studentId)throw new DomainException('NISN tidak ditemukan atau siswa sudah tidak aktif.',404);

            $attempt=null;
            if($examId>0){
                $q=$pdo->prepare('SELECT id,exam_id FROM exam_attempts WHERE student_id=? AND exam_id=? LIMIT 1');$q->execute([$studentId,$examId]);$attempt=$q->fetch();
                if(!$attempt){$visible=(new ExamRepository($pdo))->visibleForStudent($studentRow);if(!in_array($examId,array_map(fn(array$row)=>(int)$row['id'],$visible),true))throw new DomainException('Ujian tidak terkait dengan akun siswa ini.',422);}
            }elseif($category==='EXAM_LOCKED'){
                $q=$pdo->prepare("SELECT id,exam_id FROM exam_attempts WHERE student_id=? AND status='TERMINATED' ORDER BY updated_at DESC,id DESC LIMIT 1");$q->execute([$studentId]);$attempt=$q->fetch();
                if($attempt)$examId=(int)$attempt['exam_id'];
            }
            $attemptId=$attempt?(int)$attempt['id']:null;
            $duplicate=$pdo->prepare("SELECT public_id FROM support_tickets WHERE student_id=:student AND category=:category AND ((exam_id IS NULL AND :exam_null=1) OR exam_id=:exam) AND status IN ('OPEN','IN_PROGRESS') ORDER BY id DESC LIMIT 1 FOR UPDATE");
            $duplicate->execute(['student'=>$studentId,'category'=>$category,'exam_null'=>$examId<1?1:0,'exam'=>$examId?:0]);
            $existing=$duplicate->fetchColumn();
            if($existing)return $this->ticketForStudent($pdo,(string)$existing,$studentId);

            $publicId=Id::ulid();
            $insert=$pdo->prepare("INSERT INTO support_tickets(public_id,student_id,exam_id,attempt_id,category,message,status) VALUES(:public,:student,:exam,:attempt,:category,:message,'OPEN')");
            $insert->execute(['public'=>$publicId,'student'=>$studentId,'exam'=>$examId?:null,'attempt'=>$attemptId,'category'=>$category,'message'=>$message]);
            return $this->ticketForStudent($pdo,$publicId,$studentId);
        });
    }

    public function studentTickets(int $studentId):array
    {
        $q=$this->db->pdo()->prepare($this->selectSql()." WHERE t.student_id=:student ORDER BY FIELD(t.status,'OPEN','IN_PROGRESS','RESOLVED','CLOSED'),t.updated_at DESC LIMIT 20");
        $q->execute(['student'=>$studentId]);return array_map([$this,'map'],$q->fetchAll());
    }

    public function staffTickets(array $auth,?string $status=null):array
    {
        $role=(string)($auth['role']??'');$params=[];$where=[];
        if($role==='TEACHER'){
            $teacherId=(int)($auth['teacher_id']??0);if($teacherId<1)throw new DomainException('Identitas guru tidak tersedia.',403);
            $where[]='EXISTS(SELECT 1 FROM teacher_exam_assignments tea WHERE tea.teacher_id=:teacher AND tea.exam_id=t.exam_id)';$params['teacher']=$teacherId;
        }elseif($role!=='ADMIN')throw new DomainException('Akses petugas ditolak.',403);
        $status=$status!==null?strtoupper(trim($status)):null;
        if($status&&$status!=='ALL'){if(!in_array($status,self::STATUSES,true))throw new DomainException('Filter status tidak valid.',422);$where[]='t.status=:status';$params['status']=$status;}
        $sql=$this->selectSql().($where?' WHERE '.implode(' AND ',$where):'')." ORDER BY FIELD(t.status,'OPEN','IN_PROGRESS','RESOLVED','CLOSED'),t.updated_at DESC LIMIT 200";
        $q=$this->db->pdo()->prepare($sql);$q->execute($params);return array_map([$this,'map'],$q->fetchAll());
    }

    public function update(string $publicId,array $auth,string $status,string $note):array
    {
        $status=strtoupper(trim($status));if(!in_array($status,self::STATUSES,true))throw new DomainException('Status tiket tidak valid.',422);
        if(($auth['role']??'')==='TEACHER'&&in_array($status,['OPEN','CLOSED'],true))throw new DomainException('Guru dapat mengambil atau menyelesaikan tiket.',403);
        if(mb_strlen($note)>1000)throw new DomainException('Catatan petugas maksimal 1000 karakter.',422);
        return $this->db->transaction(function(PDO $pdo)use($publicId,$auth,$status,$note){
            $ticket=$this->accessibleTicket($pdo,$publicId,$auth,true);
            $resolved=in_array($status,['RESOLVED','CLOSED'],true)?gmdate('Y-m-d H:i:s'):null;
            $q=$pdo->prepare('UPDATE support_tickets SET status=?,handled_by=?,staff_note=?,resolution_type=?,resolved_at=? WHERE id=?');
            $q->execute([$status,(int)$auth['user_id'],trim($note)?:null,$status==='RESOLVED'?'ASSISTED':null,$resolved,$ticket['id']]);
            return $this->staffTicket($pdo,$publicId,$auth);
        });
    }

    public function resetAndResolve(string $publicId,array $auth,string $reason):array
    {
        if(($auth['role']??'')!=='ADMIN')throw new DomainException('Hanya admin yang dapat mereset CBT.',403);
        $ticket=$this->accessibleTicket($this->db->pdo(),$publicId,$auth,false);
        if(!(int)$ticket['exam_id'])throw new DomainException('Tiket ini tidak memiliki ujian yang dapat direset.',409);
        $result=$this->resets->reset((int)$ticket['student_id'],(int)$ticket['exam_id'],(int)$auth['user_id'],$reason);
        $updated=$this->update($publicId,$auth,'RESOLVED',trim($reason));
        $this->db->pdo()->prepare("UPDATE support_tickets SET resolution_type='CBT_RESET' WHERE public_id=?")->execute([$publicId]);
        $updated['resolutionType']='CBT_RESET';
        return ['reset'=>$result,'ticket'=>$updated];
    }

    private function accessibleTicket(PDO $pdo,string $publicId,array $auth,bool $lock):array
    {
        $sql='SELECT t.* FROM support_tickets t WHERE t.public_id=:public';$params=['public'=>$publicId];
        if(($auth['role']??'')==='TEACHER'){$sql.=' AND EXISTS(SELECT 1 FROM teacher_exam_assignments tea WHERE tea.teacher_id=:teacher AND tea.exam_id=t.exam_id)';$params['teacher']=(int)($auth['teacher_id']??0);}
        elseif(($auth['role']??'')!=='ADMIN')throw new DomainException('Akses petugas ditolak.',403);
        if($lock)$sql.=' FOR UPDATE';$q=$pdo->prepare($sql);$q->execute($params);return$q->fetch()?:throw new DomainException('Tiket tidak ditemukan atau bukan penugasan Anda.',404);
    }

    private function ticketForStudent(PDO $pdo,string $publicId,int $studentId):array
    {
        $q=$pdo->prepare($this->selectSql().' WHERE t.public_id=? AND t.student_id=?');$q->execute([$publicId,$studentId]);return$this->map($q->fetch());
    }
    private function staffTicket(PDO $pdo,string $publicId,array $auth):array{return$this->map($this->accessibleDetailed($pdo,$publicId,$auth));}
    private function accessibleDetailed(PDO $pdo,string $publicId,array $auth):array
    {
        $where=' WHERE t.public_id=:public';$params=['public'=>$publicId];
        if(($auth['role']??'')==='TEACHER'){$where.=' AND EXISTS(SELECT 1 FROM teacher_exam_assignments tea WHERE tea.teacher_id=:teacher AND tea.exam_id=t.exam_id)';$params['teacher']=(int)($auth['teacher_id']??0);}
        $q=$pdo->prepare($this->selectSql().$where);$q->execute($params);return$q->fetch()?:throw new DomainException('Tiket tidak ditemukan.',404);
    }
    private function selectSql():string
    {
        return "SELECT t.public_id,t.student_id,t.exam_id,t.attempt_id,t.category,t.message,t.status,t.staff_note,t.resolution_type,t.created_at,t.updated_at,t.resolved_at,s.nisn,s.name_snapshot student_name,s.class_snapshot class_name,e.name exam_name,a.status attempt_status,a.violation_count,u.name handler_name FROM support_tickets t JOIN students s ON s.id=t.student_id LEFT JOIN exams e ON e.id=t.exam_id LEFT JOIN exam_attempts a ON a.id=t.attempt_id LEFT JOIN users u ON u.id=t.handled_by";
    }
    private function map(array|false $row):array
    {
        if(!$row)throw new DomainException('Tiket tidak ditemukan.',404);
        return ['id'=>$row['public_id'],'studentId'=>(int)$row['student_id'],'nisn'=>$row['nisn'],'studentName'=>$row['student_name'],'className'=>$row['class_name'],'examId'=>$row['exam_id']?(int)$row['exam_id']:null,'examName'=>$row['exam_name'],'category'=>$row['category'],'message'=>$row['message'],'status'=>$row['status'],'staffNote'=>$row['staff_note'],'handlerName'=>$row['handler_name'],'resolutionType'=>$row['resolution_type'],'createdAt'=>$row['created_at'].'Z','updatedAt'=>$row['updated_at'].'Z','resolvedAt'=>$row['resolved_at']?$row['resolved_at'].'Z':null,'attemptStatus'=>$row['attempt_status'],'violationCount'=>(int)($row['violation_count']??0),'canReset'=>$row['attempt_status']==='TERMINATED'&&(int)($row['violation_count']??0)>=3];
    }
}

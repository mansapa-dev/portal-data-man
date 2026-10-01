<?php
declare(strict_types=1);
namespace Cbt\Services;
use Cbt\Core\{Database,RedisCache};
use Cbt\Exceptions\DomainException;
use Cbt\Repositories\{AttemptRepository,ExamRepository,StudentRepository};
final class ExamSessionService
{
    public function __construct(private Database $database,private StudentRepository $students,private ExamRepository $exams,private AttemptRepository $attempts){}
    public function heartbeat(int $studentId, int $examId):array
    {
        // Presence is approximate (monitoring allows 90 seconds). Cache only
        // successful refreshes; never cache answers or exam completion.
        RedisCache::remember('heartbeat:v2:'.$studentId.':'.$examId,40,function()use($studentId,$examId):bool{
            // A plain read avoids INSERT...SELECT source locks on exam_attempts.
            $statement=$this->database->pdo()->prepare("SELECT a.id,c.last_seen_at>=UTC_TIMESTAMP(3)-INTERVAL 40 SECOND AS recent FROM exam_attempts a LEFT JOIN attempt_connections c ON c.attempt_id=a.id WHERE a.student_id=:student AND a.exam_id=:exam AND a.status='IN_PROGRESS' AND a.expires_at>UTC_TIMESTAMP(3)");
            $statement->execute(['student'=>$studentId,'exam'=>$examId]);
            $attempt=$statement->fetch();
            if($attempt&&!$attempt['recent']){
                $this->database->pdo()->prepare('INSERT INTO attempt_connections(attempt_id,last_seen_at) VALUES(:attempt,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE last_seen_at=UTC_TIMESTAMP(3)')->execute(['attempt'=>$attempt['id']]);
            }
            return true;
        });
        return ['server_time'=>gmdate(DATE_ATOM)];
    }
    public function list(int $studentId,string $nisn):array
    {
        $student=$this->students->findActiveByNisn($nisn)??throw new DomainException('Data siswa tidak tersedia.',404);
        if((int)$student['id']!==$studentId)throw new DomainException('Sesi siswa tidak valid.',401);
        return array_map(function(array$exam){return ['id'=>(int)$exam['id'],'nama_ujian'=>$exam['name'],'tingkat'=>$exam['grade'],'durasi'=>(int)$exam['duration_minutes'],'sesi'=>(int)$exam['session_number'],'tanggal_mulai'=>$exam['starts_at'],'tanggal_selesai'=>$exam['ends_at'],'jam_mulai'=>substr($exam['starts_at'],11,5),'jam_selesai'=>substr($exam['ends_at'],11,5),'tahun_ajaran'=>$exam['academic_year'],'semester'=>$exam['semester'],'status_attempt'=>$exam['attempt_status'],'is_special'=>!empty($exam['follow_up_type']),'special_type'=>$exam['follow_up_type']??null,'can_start'=>(bool)($exam['can_start']??false),'availability_reason'=>$exam['availability_reason']??'NOT_ELIGIBLE'];},$this->exams->visibleForStudent($student));
    }
    public function start(int$studentId,string$nisn,int$examId):array
    {
        $state=$this->database->transaction(function()use($studentId,$nisn,$examId){
            $student=$this->students->findActiveByNisn($nisn)??throw new DomainException('Siswa tidak ditemukan.',404);
            if((int)$student['id']!==$studentId)throw new DomainException('Sesi siswa tidak valid.',401);
            $attempt=$this->attempts->find($studentId,$examId,true);
            if($attempt&&in_array($attempt['status'],['COMPLETED','TERMINATED','EXPIRED'],true))throw new DomainException('Ujian ini tidak dapat dilanjutkan.',409);
            $resuming=$attempt&&$attempt['status']==='IN_PROGRESS'&&strtotime($attempt['expires_at'].' UTC')>time();
            $exam=($resuming?$this->exams->find($examId,true):$this->exams->findEligible($examId,$student,true))??throw new DomainException('Ujian tidak tersedia untuk siswa ini.',403);
            if($attempt){$questions=$this->attempts->questions((int)$attempt['id']);}
            else{$ids=$this->exams->questionIds($examId);if(!$ids)throw new DomainException('Soal ujian belum tersedia.',409);$seed=hash('sha256',$studentId.':'.$examId.':'.random_bytes(16));$ids=$this->stableShuffle($ids,$seed);$mapping=[];foreach($ids as$id)$mapping[(string)$id]=$this->stableShuffle(['A','B','C','D','E'],hash('sha256',$seed.':'.$id));$attempt=$this->attempts->create($student,$exam,$ids,$mapping,$seed);$questions=$this->attempts->questions((int)$attempt['id']);}
            if(!$questions)throw new DomainException('Soal ujian belum tersedia.',409);
            if(strtotime($attempt['expires_at'].' UTC')<=time())throw new DomainException('Waktu ujian telah habis. Muat ulang untuk mengambil hasil.',409);
            return['exam'=>$exam,'attempt'=>$attempt,'questions'=>$questions,'answers'=>$this->attempts->answers((int)$attempt['id'])];
        });
        // Rendering and HTML sanitization are CPU work. Do them only after the
        // attempt transaction commits so a large question payload never keeps
        // row locks or a database transaction open while PHP builds JSON.
        $exam=$state['exam'];$attempt=$state['attempt'];$questions=$state['questions'];
        $byId=[];foreach($questions as$q)$byId[(int)$q['id']]=$q;$ordered=[];$mapping=json_decode($attempt['option_mapping'],true,512,JSON_THROW_ON_ERROR);
        foreach(json_decode($attempt['question_order'],true,512,JSON_THROW_ON_ERROR)as$id){$q=$byId[(int)$id];$type=$q['question_type']??'MULTIPLE_CHOICE';$options=[];if($type!=='SHORT_ANSWER')foreach($mapping[(string)$id]as$letter){$value=$q['option_'.strtolower($letter)]??null;if($value!==null&&$value!=='')$options[]=['key'=>$letter,'text'=>\Cbt\Support\QuestionHtml::clean($value)];}$ordered[]=['id'=>(int)$q['id'],'tipe'=>$type,'pertanyaan'=>\Cbt\Support\QuestionHtml::clean($q['question_text']),'opsi'=>$options,'poin'=>(float)$q['points']];}
        return['attempt_id'=>$attempt['public_id'],'exam'=>['id'=>(int)$exam['id'],'nama_ujian'=>$exam['name']],'expires_at'=>$attempt['expires_at'].'Z','server_time'=>gmdate('Y-m-d H:i:s').'Z','soal'=>$ordered,'jawaban'=>$state['answers']];
    }
    private function stableShuffle(array$values,string$seed):array{usort($values,fn($a,$b)=>strcmp(hash('sha256',$seed.':'.$a),hash('sha256',$seed.':'.$b)));return$values;}
}

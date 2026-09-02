<?php
declare(strict_types=1);
namespace Cbt\Services;
use Cbt\Core\Database;
use Cbt\Exceptions\DomainException;
use Cbt\Repositories\{AttemptRepository,ExamRepository,StudentRepository};
final class ExamSessionService
{
    public function __construct(private Database $database,private StudentRepository $students,private ExamRepository $exams,private AttemptRepository $attempts){}
    public function list(int $studentId,string $nisn):array
    {
        $student=$this->students->findActiveByNisn($nisn)??throw new DomainException('Data siswa tidak tersedia.',404);
        if((int)$student['id']!==$studentId)throw new DomainException('Sesi siswa tidak valid.',401);
        return array_map(function(array$exam)use($student){$attempt=$this->attempts->find((int)$student['id'],(int)$exam['id']);return ['id'=>(int)$exam['id'],'nama_ujian'=>$exam['name'],'tingkat'=>$exam['grade'],'durasi'=>(int)$exam['duration_minutes'],'tanggal_mulai'=>$exam['starts_at'],'tanggal_selesai'=>$exam['ends_at'],'jam_mulai'=>substr($exam['starts_at'],11,5),'jam_selesai'=>substr($exam['ends_at'],11,5),'tahun_ajaran'=>$exam['academic_year'],'semester'=>$exam['semester'],'status_attempt'=>$attempt['status']??'NOT_STARTED'];},$this->exams->eligibleForStudent($student));
    }
    public function start(int$studentId,string$nisn,int$examId):array
    {
        return $this->database->transaction(function()use($studentId,$nisn,$examId){
            $student=$this->students->findActiveByNisn($nisn)??throw new DomainException('Siswa tidak ditemukan.',404);
            if((int)$student['id']!==$studentId)throw new DomainException('Sesi siswa tidak valid.',401);
            $attempt=$this->attempts->find($studentId,$examId,true);
            if($attempt&&in_array($attempt['status'],['COMPLETED','TERMINATED','EXPIRED'],true))throw new DomainException('Ujian ini tidak dapat dilanjutkan.',409);
            $exam=$this->exams->findEligible($examId,$student,true)??throw new DomainException('Ujian tidak tersedia untuk siswa ini.',403);
            $questions=$this->exams->questions($examId);
            if(!$questions)throw new DomainException('Soal ujian belum tersedia.',409);
            if(!$attempt){$seed=hash('sha256',$studentId.':'.$examId.':'.random_bytes(16));$ids=array_map(fn($q)=>(int)$q['id'],$questions);$ids=$this->stableShuffle($ids,$seed);$mapping=[];foreach($ids as$id)$mapping[(string)$id]=$this->stableShuffle(['A','B','C','D','E'],hash('sha256',$seed.':'.$id));$attempt=$this->attempts->create($student,$exam,$ids,$mapping,$seed);}
            if(strtotime($attempt['expires_at'].' UTC')<=time()){$this->database->pdo()->prepare("UPDATE exam_attempts SET status='EXPIRED' WHERE id=:id AND status='IN_PROGRESS'")->execute(['id'=>$attempt['id']]);throw new DomainException('Waktu ujian telah habis.',409);}
            $byId=[];foreach($questions as$q)$byId[(int)$q['id']]=$q;$ordered=[];$mapping=json_decode($attempt['option_mapping'],true,512,JSON_THROW_ON_ERROR);foreach(json_decode($attempt['question_order'],true,512,JSON_THROW_ON_ERROR)as$id){$q=$byId[(int)$id];$options=[];foreach($mapping[(string)$id]as$letter){$value=$q['option_'.strtolower($letter)]??null;if($value!==null)$options[]=['key'=>$letter,'text'=>$value];}$ordered[]=['id'=>(int)$q['id'],'pertanyaan'=>$q['question_text'],'opsi'=>$options,'poin'=>(float)$q['points']];}
            return ['attempt_id'=>$attempt['public_id'],'exam'=>['id'=>(int)$exam['id'],'nama_ujian'=>$exam['name']],'expires_at'=>$attempt['expires_at'].'Z','server_time'=>gmdate('Y-m-d H:i:s').'Z','soal'=>$ordered,'jawaban'=>$this->attempts->answers((int)$attempt['id'])];
        });
    }
    private function stableShuffle(array$values,string$seed):array{usort($values,fn($a,$b)=>strcmp(hash('sha256',$seed.':'.$a),hash('sha256',$seed.':'.$b)));return$values;}
}

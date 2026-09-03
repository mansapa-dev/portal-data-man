<?php
declare(strict_types=1);
namespace Cbt\Services;
use Cbt\Core\Database;
use Cbt\Exceptions\DomainException;
use Cbt\Repositories\AdminRepository;
final class AdminService
{
 public function __construct(private Database$db,private AdminRepository$repo){}
 public function dashboard():array{return$this->repo->dashboard();}
 public function adminLiveSessions():array{return$this->liveSessionPayload($this->repo->allExamIds());}
 public function references():array{return$this->repo->references();}
 public function exams():array{return$this->repo->exams();}
 public function saveExam(array$d,int$actor):void
 {
  foreach(['nama_ujian','tingkat','durasi_menit']as$key)if(trim((string)($d[$key]??''))==='')throw new DomainException('Data ujian belum lengkap.',422);
  $date=(string)($d['tanggal_mulai']??$d['tanggal_ujian']??date('Y-m-d'));$endDate=(string)($d['tanggal_selesai']??$date);$timezone=new \DateTimeZone('Asia/Jakarta');$start=new \DateTimeImmutable($date.' '.((string)($d['jam_mulai']??'00:00')).':00',$timezone);$end=new \DateTimeImmutable($endDate.' '.((string)($d['jam_selesai']??'23:59')).':00',$timezone);if($end<=$start)throw new DomainException('Waktu selesai harus setelah waktu mulai.',422);
  $subject=$this->repo->subject((int)($d['subject_id']??0));if(!$subject)throw new DomainException('Mata pelajaran harus dipilih dari katalog mapel.',422);$yearId=trim((string)($d['portal_academic_year_id']??''));$semesterId=trim((string)($d['portal_semester_id']??''));$period=$this->repo->period($yearId,$semesterId);if(!$period)throw new DomainException('Tahun ajaran dan semester harus dipilih dari Portal Data.',422);$data=$d+['tahun_ajaran'=>$period['academic_year'],'semester'=>$period['semester']];$data['tahun_ajaran']=$period['academic_year'];$data['semester']=$period['semester'];$utc=new \DateTimeZone('UTC');$data['starts_at']=$start->setTimezone($utc)->format('Y-m-d H:i:s');$data['ends_at']=$end->setTimezone($utc)->format('Y-m-d H:i:s');$data['status']=filter_var($d['status_aktif']??false,FILTER_VALIDATE_BOOL)?'ACTIVE':'INACTIVE';
  try{$this->db->transaction(fn()=>$this->repo->saveExam($data,$actor));}catch(\UnexpectedValueException$e){throw new DomainException($e->getMessage(),422);}
 }
 public function scheduleFollowUpExam(array$d,int$actor):array
 {
  $sourceId=(int)($d['source_exam_id']??0);$studentIds=array_values(array_unique(array_filter(array_map('intval',(array)($d['student_ids']??[])))));
  if(!$sourceId||!$studentIds)throw new DomainException('Pilih ujian asal dan minimal satu siswa.',422);
  $type=strtoupper((string)($d['type']??'SUSULAN'));if(!in_array($type,['SUSULAN','REMEDIAL'],true))throw new DomainException('Jenis ujian lanjutan tidak valid.',422);
  if($type==='REMEDIAL'&&!$this->repo->approvedRetakeCandidates($sourceId,$studentIds))throw new DomainException('Setujui kandidat ujian ulang terlebih dahulu.',422);
  $source=$this->repo->examForFollowUp($sourceId)??throw new DomainException('Ujian asal tidak ditemukan atau belum memiliki soal.',404);
  $timezone=new \DateTimeZone('Asia/Jakarta');
  try{$start=new \DateTimeImmutable(trim((string)$d['starts_at']),$timezone);$end=new \DateTimeImmutable(trim((string)$d['ends_at']),$timezone);}catch(\Throwable){throw new DomainException('Tanggal dan waktu jadwal tidak valid.',422);}
  if($end<=$start)throw new DomainException('Waktu selesai harus setelah waktu mulai.',422);
  $name=trim((string)($d['name']??''));if($name==='')$name=$type==='REMEDIAL'?'Remedial - '.$source['name']:'Susulan - '.$source['name'];
  $utc=new \DateTimeZone('UTC');
  return $this->db->transaction(function()use($source,$sourceId,$studentIds,$name,$type,$start,$end,$utc,$actor,$d){$result=$this->repo->cloneFollowUpExam($source,$studentIds,$name,$type,$start->setTimezone($utc)->format('Y-m-d H:i:s'),$end->setTimezone($utc)->format('Y-m-d H:i:s'),$actor,filter_var($d['active']??true,FILTER_VALIDATE_BOOL),trim((string)($d['room']??'')),trim((string)($d['notes']??'')));$this->repo->copyTeacherAssignments($sourceId,(int)$result['id'],$actor);return$result;});
 }
 public function makeUpCandidates():array{return$this->repo->makeUpCandidates();}
 public function followUpCandidates():array{return$this->repo->followUpCandidates();}
 public function approveRetakeCandidates(array$studentIds,int$examId,int$actor):int{$ids=array_values(array_unique(array_filter(array_map('intval',$studentIds))));if(!$examId||!$ids)throw new DomainException('Pilih minimal satu kandidat ujian ulang.',422);return$this->db->transaction(fn()=>$this->repo->approveRetakeCandidates($examId,$ids,$actor));}
 public function followUpSchedules():array{return$this->repo->followUpSchedules();}
 public function setFollowUpStatus(int$id,bool$active):void{try{$this->repo->setFollowUpStatus($id,$active);}catch(\UnexpectedValueException$e){throw new DomainException($e->getMessage(),404);}}
 public function questions(?int$id):array{return$this->repo->questions($id);}
 public function saveQuestion(array$d):void{foreach(['ujian_id','pertanyaan','opsi_a','opsi_b','opsi_c','opsi_d','jawaban_benar']as$key)if(trim((string)($d[$key]??''))==='')throw new DomainException('Data soal belum lengkap.',422);$answer=strtoupper((string)$d['jawaban_benar']);if(!in_array($answer,['A','B','C','D','E'],true)||((float)($d['poin']??0))<=0)throw new DomainException('Jawaban benar atau poin tidak valid.',422);$d['jawaban_benar']=$answer;$this->repo->saveQuestion($d+['opsi_e'=>'','poin'=>1]);}
 public function users():array{return$this->repo->users();}
 public function saveUser(array$d):void{if(!preg_match('/^[A-Za-z0-9._-]{4,100}$/',(string)($d['username']??'')))throw new DomainException('Username administrator tidak valid.',422);if(empty($d['id'])&&strlen((string)($d['password']??''))<12)throw new DomainException('Password akun baru minimal 12 karakter.',422);if(!empty($d['password'])&&strlen((string)$d['password'])<12)throw new DomainException('Password minimal 12 karakter.',422);$role=strtoupper((string)($d['role']??'ADMIN'));if($role!=='ADMIN')throw new DomainException('Akun guru dikelola Portal Data dan tidak dapat dibuat di CBT.',422);$d['role']='ADMIN';$d['status_aktif']=filter_var($d['status_aktif']??false,FILTER_VALIDATE_BOOL);try{$this->repo->saveUser($d);}catch(\UnexpectedValueException$e){throw new DomainException($e->getMessage(),422);}}
 public function assignments():array{return$this->repo->assignments();}
 public function saveAssignment(array$d,int$actor):void{try{$this->repo->saveAssignment(!empty($d['id'])?(int)$d['id']:null,(int)($d['guru_id']??0),(int)($d['ujian_id']??0),$actor);}catch(\PDOException$e){if($e->getCode()==='23000')throw new DomainException('Guru sudah ditugaskan pada ujian tersebut.',409);throw$e;}catch(\UnexpectedValueException$e){throw new DomainException($e->getMessage(),422);}}
 public function deleteAssignment(int$id):void{$this->repo->deleteAssignment($id);}
 public function results():array{return$this->repo->results();}
 public function violations():array{return$this->repo->violations();}
 public function teacherDashboard(int$teacherId,string$role):array{$ids=$role==='ADMIN'?$this->repo->allExamIds():$this->repo->teacherExamIds($teacherId);$all=$this->repo->exams();$list=array_values(array_filter($all,fn($e)=>in_array($e['id'],$ids,true)));return['ujianList'=>$list,'hasilList'=>$this->repo->results($ids),'pelanggaranList'=>$this->repo->violations($ids)];}
 private function liveSessionPayload(array$examIds):array{$sessions=$this->repo->liveSessions($examIds);return['sessions'=>$sessions,'summary'=>['active'=>count(array_filter($sessions,fn(array$s):bool=>$s['status']==='IN_PROGRESS')),'answered'=>array_sum(array_column($sessions,'answeredQuestions')),'violations'=>array_sum(array_column($sessions,'violationCount')),'total'=>count($sessions)],'serverTime'=>gmdate(DATE_ATOM),'refreshSeconds'=>10];}
 public function importQuestions(array$rows):array{$valid=[];$errors=[];foreach($rows as$i=>$row){try{$exam=(int)($row['ujian_id']??0);if(!$exam&&!empty($row['nama_ujian']))$exam=$this->repo->examIdByName((string)$row['nama_ujian'])??0;$row['ujian_id']=$exam;foreach(['ujian_id','pertanyaan','opsi_a','opsi_b','opsi_c','opsi_d','jawaban_benar']as$key)if(trim((string)($row[$key]??''))==='')throw new \InvalidArgumentException("Kolom {$key} kosong");$img=trim((string)($row['url_gambar']??$row['gambar_soal']??$row['gambar']??''));if($img!==''&&!str_contains((string)$row['pertanyaan'],'<img')){$row['pertanyaan'].="<br><img src=\"".htmlspecialchars($img,ENT_QUOTES,'UTF-8')."\" style=\"max-width:100%;max-height:280px;object-fit:contain;border-radius:8px;margin:8px 0;display:block;\">";}$row['jawaban_benar']=strtoupper((string)$row['jawaban_benar']);if(!in_array($row['jawaban_benar'],['A','B','C','D','E'],true))throw new \InvalidArgumentException('Jawaban benar harus A-E');$row['poin']=(float)($row['poin']??1);$row['opsi_e']=$row['opsi_e']??'';$valid[]=$row;}catch(\Throwable$e){$errors[]=['row'=>$i+2,'reason'=>$e->getMessage()];}}if(!$valid)throw new DomainException('Tidak ada soal valid untuk diimport.',422);$this->db->transaction(function()use($valid){foreach($valid as$row)$this->repo->saveQuestion($row);});return['total'=>count($rows),'inserted'=>count($valid),'failed'=>count($errors),'errors'=>$errors];}
 public function importUsers(array$rows):array{$valid=[];$errors=[];foreach($rows as$i=>$row){try{$data=['username'=>trim((string)($row['username']??'')),'nama_lengkap'=>trim((string)($row['nama_lengkap']??'')),'password'=>(string)($row['password']??''),'role'=>'ADMIN','status_aktif'=>true];if(!preg_match('/^[A-Za-z0-9._-]{4,100}$/',$data['username'])||strlen($data['password'])<12)throw new \InvalidArgumentException('Username/password minimal 12 karakter tidak valid');$valid[]=$data;}catch(\Throwable$e){$errors[]=['row'=>$i+2,'reason'=>$e->getMessage()];}}if(!$valid)throw new DomainException('Tidak ada akun administrator valid untuk diimport.',422);$this->db->transaction(function()use($valid){foreach($valid as$row)$this->repo->saveUser($row);});return['total'=>count($rows),'inserted'=>count($valid),'failed'=>count($errors),'errors'=>$errors];}
 public function settings():array{return$this->repo->getSettings();}
 public function saveSettings(array$data):void{$allowed=['remedial_score_cap_X','remedial_score_cap_XI','remedial_score_cap_XII'];$filtered=[];foreach($allowed as$key){if(array_key_exists($key,$data)){$v=(float)$data[$key];if($v<0||$v>100)throw new DomainException("Nilai cap {$key} harus antara 0 dan 100.",422);$filtered[$key]=(string)round($v,2);}}if(!$filtered)throw new DomainException('Tidak ada pengaturan valid untuk disimpan.',422);$this->repo->saveSettings($filtered);}
}

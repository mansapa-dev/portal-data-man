<?php
declare(strict_types=1);
namespace Cbt\Services;
use Cbt\Core\Database;
use Cbt\Exceptions\DomainException;
use Cbt\Repositories\AdminRepository;
use Cbt\Core\RedisCache;
final class AdminService
{
 public function __construct(private Database$db,private AdminRepository$repo){}
 public function dashboard():array{return$this->repo->dashboard();}
 public function adminLiveSessions():array{return$this->liveSessionPayload($this->repo->allExamIds());}
 public function teacherLiveSessions(int $teacherId,int$userId=0):array{$ids=$userId>0&&$this->repo->personnelIsProctor($userId)?$this->repo->allExamIds():($userId>0?$this->repo->personnelExamIds($userId):$this->repo->teacherExamIds($teacherId));return $this->liveSessionPayload($ids);}
 public function references():array{return$this->repo->references();}
 public function exams():array{return$this->repo->exams();}
 public function saveExam(array$d,int$actor):void
 {
  foreach(['nama_ujian','tingkat','durasi_menit']as$key)if(trim((string)($d[$key]??''))==='')throw new DomainException('Data ujian belum lengkap.',422);
  $date=(string)($d['tanggal_mulai']??$d['tanggal_ujian']??date('Y-m-d'));$endDate=(string)($d['tanggal_selesai']??$date);$timezone=new \DateTimeZone('Asia/Jakarta');$start=new \DateTimeImmutable($date.' '.((string)($d['jam_mulai']??'00:00')).':00',$timezone);$end=new \DateTimeImmutable($endDate.' '.((string)($d['jam_selesai']??'23:59')).':00',$timezone);if($end<=$start)throw new DomainException('Waktu selesai harus setelah waktu mulai.',422);
  $subject=$this->repo->subject((int)($d['subject_id']??0));if(!$subject)throw new DomainException('Mata pelajaran harus dipilih dari katalog mapel.',422);$yearId=trim((string)($d['portal_academic_year_id']??''));$semesterId=trim((string)($d['portal_semester_id']??''));$period=$this->repo->period($yearId,$semesterId);if(!$period)throw new DomainException('Tahun ajaran dan semester harus dipilih dari Portal Data.',422);$data=$d+['tahun_ajaran'=>$period['academic_year'],'semester'=>$period['semester']];$data['tahun_ajaran']=$period['academic_year'];$data['semester']=$period['semester'];$utc=new \DateTimeZone('UTC');$data['starts_at']=$start->setTimezone($utc)->format('Y-m-d H:i:s');$data['ends_at']=$end->setTimezone($utc)->format('Y-m-d H:i:s');$data['status']=filter_var($d['status_aktif']??false,FILTER_VALIDATE_BOOL)?'ACTIVE':'INACTIVE';
  $duplicateFrom=(int)($d['duplicate_from']??0);
  try{$this->db->transaction(fn()=>$duplicateFrom>0?$this->repo->duplicateExam($duplicateFrom,$data,$actor):$this->repo->saveExam($data,$actor));}catch(\UnexpectedValueException$e){throw new DomainException($e->getMessage(),422);}
  if($duplicateFrom>0)$this->forgetQuestionLists([]);
 }
 public function scheduleFollowUpExam(array$d,int$actor):array
 {
  $sourceId=(int)($d['source_exam_id']??0);$studentIds=array_values(array_unique(array_filter(array_map('intval',(array)($d['student_ids']??[])))));
  if(!$sourceId||!$studentIds)throw new DomainException('Pilih ujian asal dan minimal satu siswa.',422);
  $type=strtoupper((string)($d['type']??'SUSULAN'));if(!in_array($type,['SUSULAN','REMEDIAL'],true))throw new DomainException('Jenis ujian lanjutan tidak valid.',422);
  if($type==='REMEDIAL'&&!$this->repo->approvedRetakeCandidates($sourceId,$studentIds))throw new DomainException('Setujui kandidat ujian ulang terlebih dahulu.',422);
  $source=$this->repo->examForFollowUp($sourceId)??throw new DomainException('Ujian asal tidak ditemukan atau belum memiliki soal.',404);
  $start=\Cbt\Support\ExamWindow::parse((string)($d['starts_at']??''));$end=\Cbt\Support\ExamWindow::parse((string)($d['ends_at']??''));
  if($end<=$start)throw new DomainException('Waktu selesai harus setelah waktu mulai.',422);
  \Cbt\Support\ExamWindow::assertSameDay($start,$end);
  $utc=new \DateTimeZone('UTC');
  $sourceEnds=new \DateTimeImmutable((string)$source['ends_at'],$utc);
  if($start->setTimezone($utc)<$sourceEnds)throw new DomainException('Jadwal ujian lanjutan harus dimulai setelah ujian asal selesai.',422);
  $name=trim((string)($d['name']??''));if($name==='')$name=$type==='REMEDIAL'?'Remedial - '.$source['name']:'Susulan - '.$source['name'];
  $result=$this->db->transaction(function()use($source,$sourceId,$studentIds,$name,$type,$start,$end,$utc,$actor,$d){$result=$this->repo->cloneFollowUpExam($source,$studentIds,$name,$type,$start->setTimezone($utc)->format('Y-m-d H:i:s'),$end->setTimezone($utc)->format('Y-m-d H:i:s'),$actor,filter_var($d['active']??true,FILTER_VALIDATE_BOOL),trim((string)($d['room']??'')),trim((string)($d['notes']??'')));$this->repo->copyTeacherAssignments($sourceId,(int)$result['id'],$actor);return$result;});$this->forgetFollowUpCandidates();return$result;
 }
 public function makeUpCandidates():array{return RedisCache::remember('admin:make-up-candidates:v1',20,fn()=>$this->repo->makeUpCandidates());}
 public function followUpCandidates():array{return RedisCache::remember('admin:retake-candidates:v1',20,fn()=>$this->repo->followUpCandidates());}
 public function approveRetakeCandidates(array$studentIds,int$examId,int$actor):int{$ids=array_values(array_unique(array_filter(array_map('intval',$studentIds))));if(!$examId||!$ids)throw new DomainException('Pilih minimal satu kandidat ujian ulang.',422);$count=$this->db->transaction(fn()=>$this->repo->approveRetakeCandidates($examId,$ids,$actor));$this->forgetFollowUpCandidates();return$count;}
 public function followUpSchedules():array{return$this->repo->followUpSchedules();}
 public function setFollowUpStatus(int$id,bool$active):void{try{$this->db->transaction(fn()=>$this->repo->setFollowUpStatus($id,$active));$this->forgetFollowUpCandidates();}catch(\UnexpectedValueException$e){throw new DomainException($e->getMessage(),404);}}
 private function forgetFollowUpCandidates():void{RedisCache::forget('admin:make-up-candidates:v1');RedisCache::forget('admin:retake-candidates:v1');}
 public function terminateStudentSession(string$publicId):array
 {
  if(!preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/',$publicId))throw new DomainException('Sesi siswa tidak valid.',422);
  return$this->db->transaction(function()use($publicId){$attempt=$this->repo->activeAttemptByPublicId($publicId,true)??throw new DomainException('Sesi siswa sudah tidak aktif atau tidak ditemukan.',409);$this->repo->terminateAttempts([(int)$attempt['id']]);return$attempt;});
 }
 public function terminateExamSession(int$examId):array
 {
  if($examId<=0)throw new DomainException('Ujian tidak valid.',422);
  return$this->db->transaction(function()use($examId){$attempts=$this->repo->activeAttemptsForExam($examId,true);if(!$this->repo->deactivateExam($examId)&&!$attempts)throw new DomainException('Ujian tidak ditemukan.',404);$this->repo->terminateAttempts(array_column($attempts,'id'));return$attempts;});
 }
 public function questions(?int$id):array{$key='admin:questions:v1:'.($id??'all');return RedisCache::remember($key,30,fn()=>array_map([\Cbt\Support\QuestionHtml::class,'row'],$this->repo->questions($id)),true);}
 public function saveQuestion(array$d):void
 {
  foreach(['ujian_id','pertanyaan','jawaban_benar']as$key)if(trim((string)($d[$key]??''))==='')throw new DomainException('Data soal belum lengkap.',422);
  [$type,$answer]=$this->validateQuestionType($d);if(((float)($d['poin']??0))<=0)throw new DomainException('Poin harus lebih dari 0.',422);$d['tipe_soal']=$type;
  if($type==='MULTIPLE_CHOICE'&&$answer==='E'&&trim((string)($d['opsi_e']??''))==='')throw new DomainException('Opsi E wajib diisi jika dipilih sebagai jawaban benar.',422);
  $contentKeys=['pertanyaan','opsi_a','opsi_b','opsi_c','opsi_d','opsi_e'];$imageFields=array_values(array_filter($contentKeys,static fn(string$key):bool=>preg_match('~<img\b~i',(string)($d[$key]??''))===1));
  $d['jawaban_benar']=$answer;foreach($contentKeys as$key)$d[$key]=\Cbt\Support\QuestionImage::persistInHtml((string)($d[$key]??''));$question=\Cbt\Support\QuestionHtml::row($d+['opsi_e'=>'','poin'=>1]);
  foreach($imageFields as$key)if(!preg_match('~<img\b~i',(string)($question[$key]??'')))throw new DomainException("Gambar {$key} hilang saat diproses server; soal tidak disimpan.",422);
  $duplicate=$this->findDuplicateQuestion((int)$question['ujian_id'],(string)$question['pertanyaan'],!empty($question['id'])?(int)$question['id']:null);
  if($duplicate!==null)throw new DomainException("Peringatan: soal duplikat dengan soal #{$duplicate} pada ujian yang sama.",409);
  $previousExam=!empty($question['id'])?$this->repo->activeQuestionExamId((int)$question['id']):null;
  $this->repo->saveQuestion($question);
  $this->forgetQuestionBanks(array_filter([(int)$question['ujian_id'],$previousExam]));
  $this->forgetQuestionLists(array_filter([(int)$question['ujian_id'],$previousExam]));
 }
 public function deleteQuestion(int$id):void{$examId=$id>0?$this->repo->activeQuestionExamId($id):null;if($examId===null||!$this->repo->disableQuestion($id))throw new DomainException('Soal tidak ditemukan atau sudah dihapus.',404);$this->forgetQuestionBanks([$examId]);$this->forgetQuestionLists([$examId]);}
 private function forgetQuestionBanks(array$examIds):void{foreach(array_unique(array_map('intval',$examIds))as$examId)if($examId>0){RedisCache::forget('exam:question-bank:v1:'.$examId.':snapshot');RedisCache::forget('exam:question-bank:v1:'.$examId.':public');}}
 private function forgetQuestionLists(array$examIds):void{RedisCache::forget('admin:questions:v1:all');foreach(array_unique(array_map('intval',$examIds))as$examId)if($examId>0)RedisCache::forget('admin:questions:v1:'.$examId);}
 public function users():array{return$this->repo->users();}
 public function saveUser(array$d):void{if(!preg_match('/^[A-Za-z0-9._-]{4,100}$/',(string)($d['username']??'')))throw new DomainException('Username administrator tidak valid.',422);if(empty($d['id'])&&strlen((string)($d['password']??''))<12)throw new DomainException('Password akun baru minimal 12 karakter.',422);if(!empty($d['password'])&&strlen((string)$d['password'])<12)throw new DomainException('Password minimal 12 karakter.',422);$role=strtoupper((string)($d['role']??'ADMIN'));if($role!=='ADMIN')throw new DomainException('Akun guru dikelola Portal Data dan tidak dapat dibuat di CBT.',422);$d['role']='ADMIN';$d['status_aktif']=filter_var($d['status_aktif']??false,FILTER_VALIDATE_BOOL);try{$this->repo->saveUser($d);}catch(\UnexpectedValueException$e){throw new DomainException($e->getMessage(),422);}}
 public function assignments():array{return$this->repo->assignments();}
 public function saveAssignment(array$d,int$actor):void{$duty=strtoupper((string)($d['duty_role']??'TEACHER'));if(!in_array($duty,['TEACHER','PROCTOR'],true))throw new DomainException('Jenis penugasan tidak valid.',422);try{$this->repo->saveAssignment(!empty($d['id'])?(int)$d['id']:null,(int)($d['person_id']??$d['guru_id']??0),(int)($d['ujian_id']??0),$duty,(string)($d['person_type']??'TEACHER'),$actor);}catch(\PDOException$e){if($e->getCode()==='23000')throw new DomainException('Personel sudah ditugaskan pada ujian tersebut.',409);throw$e;}catch(\UnexpectedValueException$e){throw new DomainException($e->getMessage(),422);}}
 public function setTeacherProctorEligibility(int$id,bool$eligible):void{try{$this->repo->setTeacherProctorEligibility($id,$eligible);}catch(\UnexpectedValueException$e){throw new DomainException($e->getMessage(),422);}}
 public function deleteAssignment(int$id):void{$this->repo->deleteAssignment($id);}
 public function results():array{return$this->repo->results();}
 public function violations():array{return$this->repo->violations();}
 public function proctorViolations(int$userId):array{if(!$this->repo->personnelIsProctor($userId))throw new DomainException('Log pelanggaran hanya dapat diakses petugas piket.',403);return$this->repo->violations();}
 public function teacherDashboard(int$teacherId,int$userId,string$role):array{$ids=$role==='ADMIN'?$this->repo->allExamIds():$this->repo->personnelExamIds($userId);$all=$this->repo->exams();$list=array_values(array_filter($all,fn($e)=>in_array((int)$e['id'],$ids,true)));return['ujianList'=>$list,'hasilList'=>$this->repo->results($ids),'pelanggaranList'=>$this->repo->violations($ids),'syncedAt'=>gmdate(DATE_ATOM)];}
 private function liveSessionPayload(array$examIds):array{$sessions=$this->repo->liveSessions($examIds);return['sessions'=>$sessions,'summary'=>['active'=>count(array_filter($sessions,fn(array$s):bool=>$s['status']==='IN_PROGRESS')),'online'=>count(array_filter($sessions,fn(array$s):bool=>$s['status']==='IN_PROGRESS'&&$s['connectionState']==='ONLINE')),'terminated'=>count(array_filter($sessions,fn(array$s):bool=>$s['status']==='TERMINATED')),'total'=>count($sessions)],'serverTime'=>gmdate(DATE_ATOM),'refreshSeconds'=>10];}
 public function importQuestions(array$rows):array
 {
  $valid=[];$errors=[];$seen=[];
  foreach($rows as$i=>$row){try{
   if(empty($row['id'])&&!empty($row['id_soal']))$row['id']=$row['id_soal'];$exam=(int)($row['ujian_id']??0);if(!$exam&&!empty($row['nama_ujian']))$exam=$this->repo->examIdByName((string)$row['nama_ujian'])??0;
   if($exam<=0||!$this->repo->examExists($exam))throw new \InvalidArgumentException('Ujian tidak ditemukan. Isi ujian_id yang valid dari daftar jadwal ujian.');$row['ujian_id']=$exam;
   $row['__recreated']=false;
   if(!empty($row['id'])){$oldExam=$this->repo->activeQuestionExamId((int)$row['id']);if($oldExam===null){unset($row['id']);$row['__recreated']=true;}elseif($oldExam!==$exam)throw new \InvalidArgumentException("ID soal #{$row['id']} milik ujian lain. Kosongkan id_soal untuk menambah soal baru.");}
   foreach(['ujian_id','pertanyaan','jawaban_benar']as$key)if(trim((string)($row[$key]??''))==='')throw new \InvalidArgumentException("Kolom {$key} kosong");
   $img=trim((string)($row['url_gambar']??$row['gambar_soal']??$row['gambar']??''));if($img!==''&&!str_contains((string)$row['pertanyaan'],'<img'))$row['pertanyaan'].="<br><img src=\"".htmlspecialchars($img,ENT_QUOTES,'UTF-8')."\">";
   $contentKeys=['pertanyaan','opsi_a','opsi_b','opsi_c','opsi_d','opsi_e'];$imageFields=array_values(array_filter($contentKeys,static fn(string$key):bool=>preg_match('~<img\b~i',(string)($row[$key]??''))===1));
    foreach(['pertanyaan','opsi_a','opsi_b','opsi_c','opsi_d','opsi_e']as$key)$row[$key]=\Cbt\Support\QuestionImage::persistInHtml((string)($row[$key]??''));[$row['tipe_soal'],$row['jawaban_benar']]=$this->validateQuestionType($row);if($row['tipe_soal']==='MULTIPLE_CHOICE'&&$row['jawaban_benar']==='E'&&trim((string)($row['opsi_e']??''))==='')throw new \InvalidArgumentException('Opsi E wajib diisi jika dipilih sebagai jawaban benar.');
   $row['poin']=(float)($row['poin']??1);if($row['poin']<=0)throw new \InvalidArgumentException('Poin harus lebih dari 0');$row['opsi_e']=$row['opsi_e']??'';$row=\Cbt\Support\QuestionHtml::row($row);
   foreach($imageFields as$key)if(!preg_match('~<img\b~i',(string)($row[$key]??'')))throw new \InvalidArgumentException("Gambar {$key} hilang saat diproses server; soal tidak disimpan. Periksa format gambar.");
   if(!isset($seen[$exam])){$seen[$exam]=[];foreach($this->repo->activeQuestionTexts($exam)as$existing)$seen[$exam][\Cbt\Support\QuestionFingerprint::fromHtml((string)$existing['pertanyaan'])]=['kind'=>'question','id'=>(int)$existing['id']];}
   $fingerprint=\Cbt\Support\QuestionFingerprint::fromHtml((string)$row['pertanyaan']);$currentId=!empty($row['id'])?(int)$row['id']:null;$duplicate=$seen[$exam][$fingerprint]??null;
   if($duplicate!==null&&!($duplicate['kind']==='question'&&$currentId!==null&&$duplicate['id']===$currentId)){$source=$duplicate['kind']==='question'?"soal #{$duplicate['id']}":"baris {$duplicate['row']}";throw new \InvalidArgumentException("Soal duplikat dengan {$source} pada ujian yang sama");}
   if($currentId!==null)foreach($seen[$exam]as$key=>$entry)if($entry['kind']==='question'&&$entry['id']===$currentId)unset($seen[$exam][$key]);
   $seen[$exam][$fingerprint]=['kind'=>'row','row'=>(int)($row['__excel_row']??($i+2))];$row['__image_fields']=$imageFields;$valid[]=$row;
  }catch(\Throwable$e){$errors[]=['row'=>(int)($row['__excel_row']??($i+2)),'reason'=>$e->getMessage()];}}
  $saved=$valid?$this->db->transaction(function()use($valid){$result=[];foreach($valid as$row){$id=$this->repo->saveQuestion($row);if(!$this->repo->questionStoredAs($id,(int)$row['ujian_id'],(string)$row['pertanyaan']))throw new \RuntimeException("Soal #{$id} tidak ditemukan lagi setelah disimpan.");$result[]=['row'=>(int)($row['__excel_row']??0),'id'=>$id,'exam_id'=>(int)$row['ujian_id'],'image_fields'=>$row['__image_fields'],'created'=>empty($row['id']),'recreated'=>!empty($row['__recreated'])];}return$result;}):[];
  $this->forgetQuestionBanks(array_column($saved,'exam_id'));
  $this->forgetQuestionLists(array_column($saved,'exam_id'));
  return['total'=>count($rows),'inserted'=>count($saved),'created'=>count(array_filter($saved,static fn(array$item):bool=>$item['created'])),'updated'=>count(array_filter($saved,static fn(array$item):bool=>!$item['created'])),'recreated'=>count(array_filter($saved,static fn(array$item):bool=>$item['recreated'])),'saved_questions'=>$saved,'failed'=>count($errors),'errors'=>$errors];
 }
 private function validateQuestionType(array$d):array
 {
  $aliases=['PILIHAN GANDA'=>'MULTIPLE_CHOICE','PILIHAN_GANDA'=>'MULTIPLE_CHOICE','MULTIPLE_CHOICE'=>'MULTIPLE_CHOICE','PILIHAN GANDA KOMPLEKS'=>'MULTIPLE_RESPONSE','PILIHAN_GANDA_KOMPLEKS'=>'MULTIPLE_RESPONSE','MULTIPLE_RESPONSE'=>'MULTIPLE_RESPONSE','ISIAN SINGKAT'=>'SHORT_ANSWER','ISIAN_SINGKAT'=>'SHORT_ANSWER','SHORT_ANSWER'=>'SHORT_ANSWER'];$raw=strtoupper(trim((string)($d['tipe_soal']??$d['question_type']??'MULTIPLE_CHOICE')));$type=$aliases[$raw]??throw new DomainException('Tipe soal tidak valid.',422);$answer=trim((string)($d['jawaban_benar']??''));
  if($type==='SHORT_ANSWER'){if($answer===''||mb_strlen($answer)>1000)throw new \InvalidArgumentException('Isian singkat wajib memiliki kunci jawaban.');return[$type,$answer];}
  foreach(['opsi_a','opsi_b','opsi_c','opsi_d']as$key)if(trim((string)($d[$key]??''))==='')throw new \InvalidArgumentException("Kolom {$key} kosong");$letters=array_values(array_unique(array_filter(array_map('trim',explode(',',strtoupper($answer))))));sort($letters);if(!$letters||($type==='MULTIPLE_CHOICE'&&count($letters)!==1)||($type==='MULTIPLE_RESPONSE'&&count($letters)<2))throw new \InvalidArgumentException($type==='MULTIPLE_RESPONSE'?'Kunci kompleks minimal dua pilihan, contoh A,C.':'Kunci pilihan ganda harus A-E.');foreach($letters as$letter)if(!in_array($letter,['A','B','C','D','E'],true)||trim((string)($d['opsi_'.strtolower($letter)]??''))==='')throw new \InvalidArgumentException("Opsi {$letter} kosong atau tidak valid.");return[$type,implode(',',$letters)];
 }
 private function findDuplicateQuestion(int$examId,string$html,?int$ignoreId=null):?int{$fingerprint=\Cbt\Support\QuestionFingerprint::fromHtml($html);foreach($this->repo->activeQuestionTexts($examId)as$row)if((int)$row['id']!==$ignoreId&&\Cbt\Support\QuestionFingerprint::fromHtml((string)$row['pertanyaan'])===$fingerprint)return(int)$row['id'];return null;}
 public function importUsers(array$rows):array{$valid=[];$errors=[];foreach($rows as$i=>$row){try{$data=['username'=>trim((string)($row['username']??'')),'nama_lengkap'=>trim((string)($row['nama_lengkap']??'')),'password'=>(string)($row['password']??''),'role'=>'ADMIN','status_aktif'=>true];if(!preg_match('/^[A-Za-z0-9._-]{4,100}$/',$data['username'])||strlen($data['password'])<12)throw new \InvalidArgumentException('Username/password minimal 12 karakter tidak valid');$valid[]=$data;}catch(\Throwable$e){$errors[]=['row'=>$i+2,'reason'=>$e->getMessage()];}}if(!$valid)throw new DomainException('Tidak ada akun administrator valid untuk diimport.',422);$this->db->transaction(function()use($valid){foreach($valid as$row)$this->repo->saveUser($row);});return['total'=>count($rows),'inserted'=>count($valid),'failed'=>count($errors),'errors'=>$errors];}
 public function settings():array{return$this->repo->getSettings();}
 public function saveSettings(array$data):array{$allowed=['remedial_score_cap_X','remedial_score_cap_XI','remedial_score_cap_XII'];$filtered=[];foreach($allowed as$key){if(array_key_exists($key,$data)){$v=(float)$data[$key];if($v<0||$v>100)throw new DomainException("Nilai cap {$key} harus antara 0 dan 100.",422);$filtered[$key]=(string)round($v,2);}}if(!$filtered)throw new DomainException('Tidak ada pengaturan valid untuk disimpan.',422);$this->repo->saveSettings($filtered);$saved=$this->repo->getSettings();foreach($filtered as$key=>$value){if(!isset($saved[$key])||(float)$saved[$key]['value']!==(float)$value)throw new DomainException('Pengaturan gagal diverifikasi setelah disimpan.',500);}return$saved;}
}

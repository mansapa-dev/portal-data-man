<?php
declare(strict_types=1);
// Explicit, isolated database only. Never loads production .env or credentials.
if (PHP_SAPI !== 'cli' || getenv('CBT_TEST_ISOLATED') !== '1') exit("Set CBT_TEST_ISOLATED=1 for an isolated MySQL on port 13317.\n");
spl_autoload_register(function ($class) { if (str_starts_with($class, 'Cbt\\')) require dirname(__DIR__).'/app/'.str_replace('\\','/',substr($class,4)).'.php'; });
use Cbt\Core\{Database,Request};
use Cbt\Repositories\{AttemptRepository,ExamRepository,StudentRepository};
use Cbt\Services\{AnswerService,ScoringService,ExamSessionService};
use Cbt\Middleware\RateLimitMiddleware;
use Cbt\Exceptions\DomainException;
$name='cbt_integrity_'.bin2hex(random_bytes(5));
$connection=new PDO('mysql:host=127.0.0.1;port=13317;charset=utf8mb4','root','',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$connection->exec('CREATE DATABASE `'.$name.'`');
$_ENV=array_merge($_ENV,['DB_HOST'=>'127.0.0.1','DB_PORT'=>'13317','DB_DATABASE'=>$name,'DB_USERNAME'=>'root','DB_PASSWORD'=>'']);
$db=new Database();$pdo=$db->pdo();$passed=0;
$assert=static function(bool $ok,string $label)use(&$passed){if(!$ok)throw new RuntimeException($label);echo 'PASS '.$label.PHP_EOL;$passed++;};
$reject=static function(callable $action,int $status,string $label)use($assert){try{$action();}catch(DomainException $error){$assert($error->status===$status,$label);return;}throw new RuntimeException('Expected rejection: '.$label);};
try {
 $pdo->exec((string)file_get_contents(dirname(__DIR__).'/database/schema.sql'));
 $pdo->exec((string)file_get_contents(dirname(__DIR__).'/database/migrations/20260907_answer_write_versions.sql'));
 $pdo->exec("INSERT INTO users(username,password_hash,name,role) VALUES('test-admin','unused','Test','ADMIN')");
 $pdo->exec("INSERT INTO students(portal_student_id,nisn,name_snapshot,grade_snapshot) VALUES('test-student','0000000001','Test Student','X')");
 $pdo->exec("INSERT INTO exams(public_id,name,grade,duration_minutes,starts_at,ends_at,academic_year,semester,status,created_by) VALUES('test-exam','Test Exam','X',60,UTC_TIMESTAMP()-INTERVAL 1 MINUTE,UTC_TIMESTAMP()+INTERVAL 1 HOUR,'2026','ODD','ACTIVE',1)");
 $pdo->exec("INSERT INTO questions(public_id,exam_id,question_text,option_a,option_b,option_c,option_d,correct_answer) VALUES('test-question',1,'Question','A','B','C','D','B')");
 $attempts=new AttemptRepository($pdo);$exams=new ExamRepository($pdo);$students=new StudentRepository($pdo);
 $sessions=new ExamSessionService($db,$students,$exams,$attempts);
 $session=$sessions->start(1,'0000000001',1);$attempt=$session['attempt_id'];
 $sessions->heartbeat(1,1);
 $monitor=new \Cbt\Repositories\AdminRepository($pdo);
 $live=$monitor->liveSessions([1]);
 $assert(count($live)===1 && $live[0]['connectionState']==='ONLINE','heartbeat is visible in live monitoring');
 $assert($monitor->liveSessions([])===[],'unassigned teacher receives no sessions');
 $assert(!str_contains(json_encode($live),'correct_answer'),'live monitoring does not expose answer keys');
 $answers=new AnswerService($db,$attempts);$scoring=new ScoringService($db,$attempts);
 $one=$answers->save(1,1,1,'A',false,$attempt,0,str_repeat('a',32));
 $assert($one['revision']===1,'first answer saved at revision one');
 $two=$answers->save(1,1,1,'B',true,$attempt,1,str_repeat('b',32));
 $assert($two['revision']===2,'latest answer and flag saved');
 $scoredLive=$monitor->liveSessions([1]);
 $assert((float)$scoredLive[0]['liveScore']===100.0,'live monitoring calculates temporary score without exposing answer keys');
 $duplicate=$answers->save(1,1,1,'B',true,$attempt,1,str_repeat('b',32));
 $assert($duplicate['duplicate']&&$duplicate['revision']===2,'lost response retry is idempotent');
 $reject(fn()=>$answers->save(1,1,1,'A',false,$attempt,0,str_repeat('c',32)),409,'stale write rejected');
 $reject(fn()=>$answers->save(1,1,1,'E',false,$attempt,2,str_repeat('c',32)),422,'missing option rejected');
 $reject(fn()=>$answers->save(1,1,1,'A',false,'other-attempt',2,str_repeat('c',32)),409,'different attempt rejected');
 $reject(fn()=>$answers->save(1,1,2,'A',false,$attempt,2,str_repeat('c',32)),404,'question outside snapshot order rejected');
 $pdo->exec("UPDATE questions SET question_text='Changed question',correct_answer='A',points=99 WHERE id=1");
 $pdo->exec((string)file_get_contents(dirname(__DIR__).'/database/migrations/20260907_attempt_questions.sql'));
 $resumed=$sessions->start(1,'0000000001',1);
 $assert($resumed['soal'][0]['pertanyaan']==='Question'&&(float)$resumed['soal'][0]['poin']===1.0,'resume retains original question content and points');

 $violations=new \Cbt\Services\ViolationService($db,$attempts);
 $reset=new \Cbt\Services\AttemptResetService($db);
 $violations->record(1,1,'violation:one','TAB_HIDDEN',null,'127.0.0.1','test');
 $assert($violations->record(1,1,'violation:one','TAB_HIDDEN',null,'127.0.0.1','test')['duplicate'],'violation retry is counted only once');
 $violations->record(1,1,'violation:two','TAB_HIDDEN',null,'127.0.0.1','test');
 $assert($violations->record(1,1,'violation:three','TAB_HIDDEN',null,'127.0.0.1','test')['terminated'],'third violation terminates only this attempt');
 $pdo->exec("UPDATE exams SET status='INACTIVE' WHERE id=1");
 $resettableStudent=(new \Cbt\Repositories\AdminStudentRepository($pdo))->all()[0];
 $assert((int)$resettableStudent['reset_exam_id']===1&&$resettableStudent['reset_exam_name']==='Test Exam','admin student list exposes a resettable exam while its schedule is inactive');
 $scoring->submit(1,1,true);
 $assert($monitor->liveSessions([1])===[],'scored terminated attempt leaves live monitoring');
 $pdo->exec("INSERT INTO users(username,password_hash,name,role) VALUES('teacher','unused','Teacher','TEACHER')");
 $reject(fn()=>$reset->reset(1,1,2,'Not allowed'),403,'teacher cannot reset a terminated exam');
 $_SESSION['auth']=['user_id'=>2,'role'=>'TEACHER'];$allowed=false;
 $protected=new \Cbt\Middleware\AuthMiddleware('auth','ADMIN',$pdo);
 $response=$protected(new Request('POST','/',[],[],[]),function()use(&$allowed){$allowed=true;return \Cbt\Core\Response::json(null);});
 $assert(!$allowed,'admin middleware rejects teacher reset route');
 $reject(fn()=>$reset->reset(1,1,1,''),422,'reset requires an audit reason');
 $opened=$reset->reset(1,1,1,'Pengawas memverifikasi gangguan perangkat');
 $assert($opened['attempt_id']===$attempt,'reset retains the same attempt identity');
 $reject(fn()=>$reset->reset(1,1,1,'duplicate'),409,'duplicate reset cannot grant extra time');
 $reject(fn()=>$scoring->submit(1,1,true),409,'stale automatic submit cannot close a reset attempt');
 $assert($scoring->recover(1,1)===null,'reset removes locked result from active recovery');
 $resetDashboard=array_values(array_filter($sessions->list(1,'0000000001'),fn($e)=>$e['id']===1))[0];
 $assert($resetDashboard['can_start']&&$resetDashboard['availability_reason']==='AVAILABLE','reset attempt remains available on the dashboard while its schedule is inactive');
 $resumeAfterReset=$sessions->start(1,'0000000001',1);
 $assert($resumeAfterReset['soal']===$resumed['soal']&&$resumeAfterReset['jawaban']===$resumed['jawaban'],'reset resumes outside the schedule and preserves question order, options, accepted answers, flags and revisions');
 $assert((int)$pdo->query('SELECT violation_count FROM exam_attempts WHERE id=1')->fetchColumn()===0,'reset restarts violation allowance');
 $assert((int)$pdo->query('SELECT COUNT(*) FROM violations')->fetchColumn()===3,'reset retains historical violation events');
 $audit=json_decode($pdo->query("SELECT before_data FROM audit_logs WHERE action='CBT_ATTEMPT_RESUMED'")->fetchColumn(),true);
 $assert((float)$audit['result']['score']===100.0,'previous locked score is archived atomically');

 $assert(strtotime($opened['expires_at'])>time(),'reset restores the remaining time while the schedule is inactive');
 $assert(!$violations->record(1,1,'reset-cycle:one','TAB_HIDDEN',null,'127.0.0.1','test')['terminated'],'first violation after reset starts a new allowance');
 $assert(!$violations->record(1,1,'reset-cycle:two','TAB_HIDDEN',null,'127.0.0.1','test')['terminated'],'second violation after reset remains a warning');
 $violations->record(1,1,'reset-cycle:three','TAB_HIDDEN',null,'127.0.0.1','test');
 $pdo->exec("UPDATE exams SET status='ACTIVE',ends_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE id=1");
 $resettableEnded=(new \Cbt\Repositories\AdminStudentRepository($pdo))->all()[0];
 $assert((int)$resettableEnded['reset_exam_id']===1,'admin reset button remains available after the schedule ends');
 $openedAfterSchedule=$reset->reset(1,1,1,'Second authorized reset after schedule ended');
 $assert(strtotime($openedAfterSchedule['expires_at'])>time()&&strtotime($openedAfterSchedule['expires_at'])>strtotime($pdo->query('SELECT ends_at FROM exams WHERE id=1')->fetchColumn().' UTC'),'reset restores remaining time beyond the ended schedule');
 $endedDashboard=array_values(array_filter($sessions->list(1,'0000000001'),fn($e)=>$e['id']===1))[0];
 $assert($endedDashboard['can_start']&&$endedDashboard['availability_reason']==='AVAILABLE','student can continue a reset attempt after the schedule ends');
 $sessions->start(1,'0000000001',1);
 $pdo->exec("INSERT INTO exams(public_id,name,grade,duration_minutes,starts_at,ends_at,academic_year,semester,status,created_by) VALUES('upcoming','Upcoming','X',60,UTC_TIMESTAMP()+INTERVAL 1 DAY,UTC_TIMESTAMP()+INTERVAL 2 DAY,'2026','ODD','ACTIVE',1)");
 $visible=$sessions->list(1,'0000000001');
 $future=array_values(array_filter($visible,fn($e)=>$e['id']===2))[0];
 $assert(!$future['can_start']&&$future['availability_reason']==='UPCOMING','dashboard includes future exams but blocks starting early');
 $reject(fn()=>$sessions->start(1,'0000000001',2),403,'server rejects early starts even with direct request');
 $pdo->exec("UPDATE exam_attempts SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND");
 $reject(fn()=>$answers->save(1,1,1,'A',false,$attempt,2,str_repeat('d',32)),409,'late answer rejected');
 $assert($answers->save(1,1,1,'B',true,$attempt,1,str_repeat('b',32))['duplicate'],'previously saved write acknowledged after deadline');
 $summary=$scoring->finalizeDue();$assert($summary['completed']===1&&$summary['failed']===0,'server finalizes expired attempt without browser');
 $result=$scoring->submit(1,1);$assert((float)$result['nilai']===100.0,'score uses latest accepted answer');
 $reject(fn()=>$reset->reset(1,1,1,'completed'),409,'completed exams cannot be reset for another attempt');
 $pdo->exec("UPDATE exam_attempts SET status='IN_PROGRESS',completed_at=NULL WHERE id=1");
 $scoring->submit(1,1);$assert($pdo->query('SELECT status FROM exam_attempts WHERE id=1')->fetchColumn()==='COMPLETED','existing result repairs stale in-progress attempt status');
 $assert((int)$pdo->query('SELECT COUNT(*) FROM exam_results')->fetchColumn()===1,'repeated submit produces exactly one result');
 $assert($scoring->recover(1,1)['completed']===true,'refresh recovers committed result');
 $review=$scoring->review(1,1);
 $assert($review['soal'][0]['status']==='BENAR'&&!isset($review['soal'][0]['jawaban_benar'],$review['soal'][0]['opsi'],$review['jawaban']),'completed student receives correctness without answer key before the exam schedule ends');
 $pdo->exec("UPDATE exams SET ends_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE id=1");
 $closed=array_values(array_filter($sessions->list(1,'0000000001'),fn($e)=>$e['id']===1));$assert(count($closed)===1&&!$closed[0]['can_start'],'result remains available after schedule closes');
 $pdo->exec('DELETE FROM attempt_questions WHERE attempt_id=1');
 $legacyReview=$scoring->review(1,1);
 $assert(count($legacyReview['soal'])===1&&$legacyReview['soal'][0]['status']==='SALAH'&&!isset($legacyReview['soal'][0]['jawaban_benar']),'legacy review repairs a missing question snapshot without exposing its answer key');
 $unsafe='<b onclick="bad()">Safe</b><script>bad()</script><img src="javascript:bad()" onerror="bad()"><img src="assets/question.png" onerror="bad()">';
 $safe=\Cbt\Support\QuestionHtml::clean($unsafe);
 $assert(str_contains($safe,'<b>Safe</b>')&&!str_contains($safe,'bad()')&&str_contains($safe,'assets/question.png'),'question sanitizer strips executable markup and retains local images');
 $rate=new RateLimitMiddleware($pdo,'student-login');
 $r1=new Request('POST','/',[],['nisn'=>'0000000001'],['REMOTE_ADDR'=>'10.0.0.1']);
 $r2=new Request('POST','/',[],['nisn'=>'0000000002'],['REMOTE_ADDR'=>'10.0.0.1']);
 $assert($rate->bucketKey($r1)!==$rate->bucketKey($r2),'students sharing an IP have independent login limits');
 $limited=new RateLimitMiddleware($pdo,'student-login',8,300);$accepted=0;
 for($i=0;$i<9;$i++)$limited($r1,function()use(&$accepted){$accepted++;return \Cbt\Core\Response::json(null);});
 $assert($accepted===8,'login bucket blocks the ninth request for the same account');
 $limited($r2,function()use(&$accepted){$accepted++;return \Cbt\Core\Response::json(null);});
 $assert($accepted===9,'another student on the same IP can still log in');
 $reject(fn()=>(new \Cbt\Services\AdminStudentService($db,new \Cbt\Repositories\AdminStudentRepository($pdo),new \Cbt\Support\SecretCipher()))->reset(1),409,'legacy global reset is rejected without changing results');
 $pdo->exec("UPDATE students SET cbt_status='BLOCKED' WHERE id=1");$_SESSION['student']=['student_id'=>1];$allowed=false;
 (new \Cbt\Middleware\AuthMiddleware('student',null,$pdo))($r1,function()use(&$allowed){$allowed=true;return \Cbt\Core\Response::json(null);});
 $assert(!$allowed&&!isset($_SESSION['student']),'revoked student session is rejected on protected requests');

 $window=\Cbt\Support\ExamWindow::class;
 $window::assertSameDay($window::parse('2026-09-09 08:00'),$window::parse('2026-09-09 16:00'));
 $assert(true,'follow-up exam accepts one local calendar day');
 $window::assertSameDay(new DateTimeImmutable('2026-09-08 18:00 UTC'),new DateTimeImmutable('2026-09-09 10:00 UTC'));
 $assert(true,'same WIB day may span two UTC dates');
 $reject(fn()=>$window::assertSameDay($window::parse('2026-09-09 23:00'),$window::parse('2026-09-10 01:00')),422,'follow-up exam rejects crossing WIB midnight');
 $reject(fn()=>$window::parse('2026-02-30 08:00'),422,'follow-up schedule rejects impossible dates');
 $reject(fn()=>$window::parse(''),422,'follow-up schedule rejects empty dates');
 $pdo->exec("INSERT INTO students(portal_student_id,nisn,name_snapshot,grade_snapshot) VALUES('stale-student','0000000002','Stale','X')");

 $adminService=new \Cbt\Services\AdminService($db,new \Cbt\Repositories\AdminRepository($pdo));
 $day=gmdate('Y-m-d',time()+86400);$later=gmdate('Y-m-d',time()+172800);
 $schedule=['type'=>'SUSULAN','source_exam_id'=>1,'student_ids'=>[2],'starts_at'=>$day.' 08:00','ends_at'=>$day.' 09:00','active'=>true];
 $firstSchedule=$adminService->scheduleFollowUpExam($schedule,1);
 $secondSchedule=$adminService->scheduleFollowUpExam(array_replace($schedule,['name'=>'Second subject','starts_at'=>$day.' 10:00','ends_at'=>$day.' 11:00']),1);
 $assert($firstSchedule['id']!==$secondSchedule['id'],'multiple follow-up schedules share one day');
 $different=array_replace($schedule,['starts_at'=>$later.' 08:00','ends_at'=>$later.' 09:00']);
 $reject(fn()=>$adminService->scheduleFollowUpExam($different,1),422,'different active follow-up dates in one period are rejected');
 $draft=$adminService->scheduleFollowUpExam(array_replace($different,['active'=>false]),1);
 $reject(fn()=>$adminService->setFollowUpStatus((int)$draft['id'],true),422,'activating a draft cannot bypass the common follow-up day');
 $assert($pdo->query('SELECT status FROM exams WHERE id='.(int)$draft['id'])->fetchColumn()==='INACTIVE','failed activation leaves draft inactive');
 $portal=new class implements \Cbt\Integrations\PortalData\PortalDataClientInterface {
  public bool $changing=false;
  private int $revisionCalls=0;
  public function revisions():array{$value=hash('sha256',$this->changing?(string)++$this->revisionCalls:'stable');return array_fill_keys(['STUDENTS','TEACHERS','CLASSES','ACADEMIC_YEARS','SEMESTERS'],$value);}
  public array $rows=[['id'=>'test-student','nisn'=>'0000000001','name'=>'Updated Student','grade'=>'10','is_active'=>true],['id'=>'inactive-remote','nisn'=>'0000000003','name'=>'Inactive','is_active'=>false]];
  public function students(int $page,int $limit):array{return ['items'=>$this->rows,'has_more'=>false];}
  public function teachers(int $page,int $limit):array{return ['items'=>[],'has_more'=>false];}
  public function classes(int $page,int $limit):array{return ['items'=>[],'has_more'=>false];}
  public function academicYears():array{return ['items'=>[],'has_more'=>false];}
  public function semesters(?string $academicYearId=null):array{return ['items'=>[],'has_more'=>false];}
 };
 $sync=new \Cbt\Services\PortalDataSyncService($db,$portal);
 $synced=$sync->sync('STUDENTS',1);
 $assert($synced['status']==='SUCCESS'&&$synced['deactivated']===1,'successful sync deactivates students absent from active Portal list');
 $assert((int)$pdo->query("SELECT COUNT(*) FROM students WHERE portal_student_id='inactive-remote'")->fetchColumn()===0,'inactive remote students are never imported');
 $assert($pdo->query('SELECT name_snapshot FROM students WHERE id=1')->fetchColumn()==='Updated Student','sync updates existing student identity');
 $assert(count((new \Cbt\Repositories\AdminStudentRepository($pdo))->all())===1,'admin list excludes inactive students');
 $portal->rows=[['id'=>'invalid','nisn'=>'bad','name'=>'Invalid']];
 try{$sync->sync('STUDENTS',1);throw new RuntimeException('Expected failed sync');}catch(UnexpectedValueException){}
 $assert((int)$pdo->query('SELECT is_active FROM students WHERE id=1')->fetchColumn()===1,'partial sync never deactivates untouched students');

 $portal->rows=[['id'=>'test-student','nisn'=>'0000000001','name'=>'Updated Student','grade'=>'10','is_active'=>true]];$portal->changing=true;
 $pdo->exec('UPDATE students SET is_active=1,last_synced_at=NULL WHERE id=2');
 try{$sync->sync('STUDENTS',1);throw new RuntimeException('Expected unstable snapshot rejection');}catch(UnexpectedValueException){}
 $assert((int)$pdo->query('SELECT is_active FROM students WHERE id=2')->fetchColumn()===1,'changing paginated Portal snapshot cannot accidentally deactivate students');
 $portal->changing=false;
 $pdo->exec("INSERT INTO teachers(portal_teacher_id,name_snapshot,status) VALUES('inactive-teacher','Teacher','ACTIVE')");
 $pdo->exec('UPDATE users SET teacher_id=1 WHERE id=2');
 $sync->sync('TEACHERS',1);
 $_SESSION['auth']=['user_id'=>2,'role'=>'TEACHER'];$allowed=false;
 (new \Cbt\Middleware\AuthMiddleware('auth','TEACHER',$pdo))($r1,function()use(&$allowed){$allowed=true;return \Cbt\Core\Response::json(null);});
 $assert(!$allowed,'deactivated Portal teacher loses access on next protected request');
 echo "{$passed} integration checks passed.\n";
} finally { $connection->exec('DROP DATABASE `'.$name.'`'); }

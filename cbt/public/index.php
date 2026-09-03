<?php
declare(strict_types=1);
require dirname(__DIR__).'/bootstrap.php';
use Cbt\Controllers\{AdminController,AdminStudentController,AuthController,StudentExamController,SyncController,SetupController,TeacherController,TeacherSsoController};
use Cbt\Core\{Database,Request,Response,Router,ViewRenderer};
use Cbt\Middleware\{AuditMiddleware,AuthMiddleware,CsrfMiddleware,RateLimitMiddleware};
use Cbt\Repositories\{AdminRepository,AdminStudentRepository,AttemptRepository,ExamRepository,StudentRepository,UserRepository};
use Cbt\Services\{AnswerService,AuthService,ExamSessionService,ScoringService,ViolationService};
use Cbt\Services\PortalDataSyncService;
use Cbt\Services\AdminService;
use Cbt\Services\AdminStudentService;
use Cbt\Support\SecretCipher;
use Cbt\Integrations\PortalData\HttpPortalDataClient;

$request=Request::capture();
if($request->path==='/'||$request->path==='/index.php'){
 $html=file_get_contents(dirname(__DIR__).'/index.html')?:'';
 $html=(new ViewRenderer(dirname(__DIR__).'/resources/views/app'))->render($html);
 $html=str_replace('</body>','<script src="assets/js/native-api-adapter.js"></script></body>',$html);
 Response::html($html)->send();
}
if($request->path==='/guru')Response::html((string)include dirname(__DIR__).'/resources/views/teacher/login.php')->send();
if($request->path==='/guru/dashboard'){
 if(($_SESSION['auth']['role']??null)!=='TEACHER'){header('Location: ./');exit;}
 Response::html((string)include dirname(__DIR__).'/resources/views/teacher/dashboard.php')->send();
}
if($request->path==='/health'){
 try{(new Database())->pdo()->query('SELECT 1');Response::json(['status'=>'ok','database'=>'ok','time'=>gmdate(DATE_ATOM)])->send();}
 catch(Throwable){Response::error('CBT belum siap menerima trafik.',503)->send();}
}
$database=new Database();$pdo=$database->pdo();
$students=new StudentRepository($pdo);$users=new UserRepository($pdo);$exams=new ExamRepository($pdo);$attempts=new AttemptRepository($pdo);
$auth=new AuthController(new AuthService($students,$users));
$student=new StudentExamController(new ExamSessionService($database,$students,$exams,$attempts),new AnswerService($database,$attempts),new ViolationService($database,$attempts),new ScoringService($database,$attempts));
$sync=new SyncController(new PortalDataSyncService($database,new HttpPortalDataClient()));
$setup=new SetupController($database);
$adminService=new AdminService($database,new AdminRepository($pdo));$admin=new AdminController($adminService);$teacher=new TeacherController($adminService);$teacherSso=new TeacherSsoController($pdo);
$adminStudents=new AdminStudentController(new AdminStudentService($database,new AdminStudentRepository($pdo),new SecretCipher()));
$csrf=new CsrfMiddleware();$studentAuth=new AuthMiddleware('student');
$adminAuth=new AuthMiddleware('auth','ADMIN');
$staffAuth=new AuthMiddleware('auth');
$studentLoginRate=new RateLimitMiddleware($pdo,'student-login',8,300);$staffLoginRate=new RateLimitMiddleware($pdo,'staff-login',6,300);$violationRate=new RateLimitMiddleware($pdo,'violation',20,60);$submitRate=new RateLimitMiddleware($pdo,'submit',8,60);
$audit=fn(string$action,?string$type=null)=>new AuditMiddleware($pdo,$action,$type);
$router=new Router();
$router->get('/api/auth/me',[$auth,'me']);
$router->get('/auth/sso/start',[$teacherSso,'start']);$router->get('/auth/sso/callback',[$teacherSso,'callback']);$router->get('/auth/sso/logout',[$teacherSso,'logout']);
$router->post('/api/setup/admin',[$setup,'create'],[$csrf,$audit('INITIAL_ADMIN_CREATED','User')]);
$router->post('/api/auth/student/login',[$auth,'studentLogin'],[$studentLoginRate,$csrf,$audit('STUDENT_LOGIN','Student')]);
$router->post('/api/auth/staff/login',[$auth,'staffLogin'],[$staffLoginRate,$csrf,$audit('STAFF_LOGIN','User')]);
$router->post('/api/auth/logout',[$auth,'logout'],[$csrf]);
$router->post('/api/auth/password',[$auth,'changePassword'],[$staffAuth,$csrf,$audit('PASSWORD_CHANGED','User')]);
$router->get('/api/student/exams',[$student,'index'],[$studentAuth]);
$router->post('/api/student/exams/{id}/start',[$student,'start'],[$studentAuth,$csrf]);
$router->put('/api/student/exams/{id}/answers/{questionId}',[$student,'answer'],[$studentAuth,$csrf]);
$router->post('/api/student/exams/{id}/violations',[$student,'violation'],[$studentAuth,$violationRate,$csrf,$audit('VIOLATION_RECORDED','Exam')]);
$router->post('/api/student/exams/{id}/submit',[$student,'submit'],[$studentAuth,$submitRate,$csrf,$audit('EXAM_SUBMITTED','Exam')]);
$router->get('/api/student/exams/{id}/review',[$student,'review'],[$studentAuth]);
$router->post('/api/admin/portal-data/sync/{type}',[$sync,'run'],[$adminAuth,$csrf,$audit('PORTAL_DATA_SYNC','PortalData')]);
$router->get('/api/admin/portal-data/sync/status',[$sync,'status'],[$adminAuth]);
$router->get('/api/admin/dashboard',[$admin,'dashboard'],[$adminAuth]);
$router->get('/api/admin/portal-data/references',[$admin,'references'],[$adminAuth]);
$router->get('/api/admin/students',[$adminStudents,'index'],[$adminAuth]);
$router->post('/api/admin/students/pin',[$adminStudents,'setPin'],[$adminAuth,$csrf,$audit('STUDENT_PIN_CHANGED','Student')]);
$router->post('/api/admin/students/generate-pins',[$adminStudents,'generateBatch'],[$adminAuth,$csrf,$audit('STUDENT_PINS_GENERATED','Student')]);
$router->post('/api/admin/students/{id}/reset',[$adminStudents,'reset'],[$adminAuth,$csrf,$audit('STUDENT_ATTEMPT_RESET','Student')]);
$router->get('/api/admin/exams',[$admin,'exams'],[$adminAuth]);
$router->post('/api/admin/exams',[$admin,'saveExam'],[$adminAuth,$csrf,$audit('EXAM_SAVED','Exam')]);
$router->post('/api/admin/follow-up-exams',[$admin,'scheduleFollowUpExam'],[$adminAuth,$csrf,$audit('FOLLOW_UP_EXAM_SCHEDULED','Exam')]);
$router->get('/api/admin/follow-up-exams/candidates',[$admin,'followUpCandidates'],[$adminAuth]);
$router->get('/api/admin/follow-up-exams',[$admin,'followUpSchedules'],[$adminAuth]);
$router->post('/api/admin/follow-up-exams/{id}/status',[$admin,'setFollowUpStatus'],[$adminAuth,$csrf,$audit('FOLLOW_UP_EXAM_STATUS_CHANGED','Exam')]);
$router->get('/api/admin/questions',[$admin,'questions'],[$adminAuth]);
$router->post('/api/admin/questions',[$admin,'saveQuestion'],[$adminAuth,$csrf,$audit('QUESTION_SAVED','Question')]);
$router->post('/api/admin/questions/import',[$admin,'importQuestions'],[$adminAuth,$csrf,$audit('QUESTIONS_IMPORTED','Question')]);
$router->get('/api/admin/users',[$admin,'users'],[$adminAuth]);
$router->post('/api/admin/users',[$admin,'saveUser'],[$adminAuth,$csrf,$audit('USER_SAVED','User')]);
$router->post('/api/admin/users/import',[$admin,'importUsers'],[$adminAuth,$csrf,$audit('USERS_IMPORTED','User')]);
$router->get('/api/admin/teacher-assignments',[$admin,'assignments'],[$adminAuth]);
$router->post('/api/admin/teacher-assignments',[$admin,'saveAssignment'],[$adminAuth,$csrf,$audit('TEACHER_ASSIGNMENT_SAVED','TeacherExamAssignment')]);
$router->delete('/api/admin/teacher-assignments/{id}',[$admin,'deleteAssignment'],[$adminAuth,$csrf,$audit('TEACHER_ASSIGNMENT_DELETED','TeacherExamAssignment')]);
$router->get('/api/admin/results',[$admin,'results'],[$adminAuth]);
$router->get('/api/admin/violations',[$admin,'violations'],[$adminAuth]);
$router->get('/api/teacher/dashboard',[$teacher,'dashboard'],[$staffAuth]);
$router->dispatch($request)->send();

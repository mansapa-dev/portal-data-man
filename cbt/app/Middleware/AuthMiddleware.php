<?php
declare(strict_types=1);
namespace Cbt\Middleware;
use Cbt\Core\{Config,RedisCache,Request,Response};
final class AuthMiddleware
{
 public function __construct(private string $type, private ?string $role=null, private ?\PDO $db=null, private bool $allowBlockedStudent=false){}
 public function __invoke(Request $r,callable $next):Response
 {
  $auth=$_SESSION[$this->type]??null;
  if(!$auth)return Response::error('Silakan login terlebih dahulu.',401);
  if($this->role!==null&&($this->role==='PERSONNEL'?!in_array(($auth['role']??null),['TEACHER','EMPLOYEE'],true):($auth['role']??null)!==$this->role))return Response::error('Akses ditolak.',403);
  if($this->db){
   $student=$this->type==='student';
   $identity=(int)($auth[$student?'student_id':'user_id']??0);$role=(string)($auth['role']??'');$ttl=max(1,min(30,(int)Config::get('AUTH_STATUS_CACHE_TTL',10)));
   $cacheKey=$student?'auth-valid:student:'.$identity.':blocked:'.(int)$this->allowBlockedStudent:'auth-valid:staff:'.$identity.':'.$role;
   $valid=RedisCache::remember($cacheKey,$ttl,function()use($student,$identity,$role):bool{
    $studentSql=$this->allowBlockedStudent?'SELECT id FROM students WHERE id=:id AND is_active=1':"SELECT id FROM students WHERE id=:id AND is_active=1 AND cbt_status='ACTIVE'";
    $s=$this->db->prepare($student?$studentSql:"SELECT id FROM users WHERE id=:id AND status='ACTIVE' AND role=:role");
    $params=['id'=>$identity];if(!$student)$params['role']=$role;$s->execute($params);$valid=(bool)$s->fetchColumn();
    if($valid&&!$student&&$role==='TEACHER'){$teacher=$this->db->prepare("SELECT t.id FROM teachers t JOIN users u ON u.teacher_id=t.id WHERE u.id=? AND t.status='ACTIVE'");$teacher->execute([$identity]);$valid=(bool)$teacher->fetchColumn();}
    if($valid&&!$student&&$role==='EMPLOYEE'){$employee=$this->db->prepare("SELECT p.id FROM employees p JOIN users u ON u.employee_id=p.id WHERE u.id=? AND p.status='ACTIVE'");$employee->execute([$identity]);$valid=(bool)$employee->fetchColumn();}
    return$valid;
   });
   if(!$valid){unset($_SESSION[$this->type]);return Response::error('Akun sudah tidak aktif. Silakan hubungi pengawas.',401);}
  }
  // Session data has been read and all authorization decisions are complete.
  // Release PHP's per-session lock before database work (answer saves,
  // heartbeats, and polling) so concurrent requests from the same student do
  // not queue behind one another.
  if(session_status()===PHP_SESSION_ACTIVE)session_write_close();
  return $next($r);
 }
}

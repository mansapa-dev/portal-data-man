<?php
declare(strict_types=1);
namespace Cbt\Middleware;
use Cbt\Core\{Request,Response};
final class AuthMiddleware
{
 public function __construct(private string $type, private ?string $role=null, private ?\PDO $db=null, private bool $allowBlockedStudent=false){}
 public function __invoke(Request $r,callable $next):Response
 {
  $auth=$_SESSION[$this->type]??null;
  if(!$auth)return Response::error('Silakan login terlebih dahulu.',401);
  if($this->role!==null&&($auth['role']??null)!==$this->role)return Response::error('Akses ditolak.',403);
  if($this->db){
   $student=$this->type==='student';
   $studentSql=$this->allowBlockedStudent?'SELECT id FROM students WHERE id=:id AND is_active=1':"SELECT id FROM students WHERE id=:id AND is_active=1 AND cbt_status='ACTIVE'";
   $s=$this->db->prepare($student?$studentSql:"SELECT id FROM users WHERE id=:id AND status='ACTIVE' AND role=:role");
   $params=['id'=>$auth[$student?'student_id':'user_id']??0];if(!$student)$params['role']=$auth['role']??'';
   $s->execute($params);
   $valid=(bool)$s->fetchColumn();
   if($valid&&!$student&&($auth['role']??'')==='TEACHER'){
    $teacher=$this->db->prepare("SELECT t.id FROM teachers t JOIN users u ON u.teacher_id=t.id WHERE u.id=? AND t.status='ACTIVE'");$teacher->execute([$auth['user_id']]);$valid=(bool)$teacher->fetchColumn();
   }
   if(!$valid){unset($_SESSION[$this->type]);return Response::error('Akun sudah tidak aktif. Silakan hubungi pengawas.',401);}
  }
  return $next($r);
 }
}

<?php
declare(strict_types=1);
namespace Cbt\Middleware;
use Cbt\Core\{Request,Response};
use PDO;
final class AuditMiddleware
{
 public function __construct(private PDO$db,private string$action,private ?string$entityType=null){}
 public function __invoke(Request$r,callable$next):Response
 {
  $response=$next($r);$auth=$_SESSION['auth']??null;$student=$_SESSION['student']??null;$entityId=$r->attributes['id']??$r->attributes['questionId']??($student['nisn']??null);$statement=$this->db->prepare('INSERT INTO audit_logs(actor_user_id,actor_role,action,entity_type,entity_id,ip_address,user_agent) VALUES(:actor,:role,:action,:type,:entity,:ip,:agent)');$statement->execute(['actor'=>$auth['user_id']??null,'role'=>$auth['role']??($student?'STUDENT':null),'action'=>$this->action,'type'=>$this->entityType,'entity'=>$entityId!==null?(string)$entityId:null,'ip'=>substr($r->ip(),0,45),'agent'=>substr((string)($r->server['HTTP_USER_AGENT']??''),0,500)]);return$response;
 }
}

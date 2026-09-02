<?php
declare(strict_types=1);
namespace Cbt\Services;
use Cbt\Core\Database;
use Cbt\Exceptions\DomainException;
use Cbt\Repositories\AttemptRepository;
use Cbt\Support\Id;
final class ViolationService
{
 public function __construct(private Database$db,private AttemptRepository$attempts){}
 public function record(int$studentId,int$examId,string$eventKey,string$type,?string$clientTime,string$ip,string$userAgent):array{return$this->db->transaction(function()use($studentId,$examId,$eventKey,$type,$clientTime,$ip,$userAgent){$attempt=$this->attempts->find($studentId,$examId,true)??throw new DomainException('Sesi ujian tidak ditemukan.',404);if($attempt['status']!=='IN_PROGRESS')throw new DomainException('Ujian sudah tidak aktif.',409);if(!in_array($type,['TAB_HIDDEN','WINDOW_BLUR','FULLSCREEN_EXIT','OTHER'],true))$type='OTHER';if(!preg_match('/^[A-Za-z0-9:_-]{8,100}$/',$eventKey))throw new DomainException('Event pelanggaran tidak valid.',422);$insert=$this->db->pdo()->prepare('INSERT IGNORE INTO violations(public_id,attempt_id,event_key,type,occurred_at,client_occurred_at,ip_address,user_agent) VALUES(:public,:attempt,:event,:type,UTC_TIMESTAMP(3),:client,:ip,:agent)');$insert->execute(['public'=>Id::ulid(),'attempt'=>$attempt['id'],'event'=>$eventKey,'type'=>$type,'client'=>$clientTime,'ip'=>substr($ip,0,45),'agent'=>substr($userAgent,0,500)]);if($insert->rowCount()===0)return['jumlah'=>(int)$attempt['violation_count'],'terminated'=>false,'duplicate'=>true];$count=(int)$attempt['violation_count']+1;$terminated=$count>=3;$this->db->pdo()->prepare('UPDATE exam_attempts SET violation_count=:count,status=:status WHERE id=:id')->execute(['count'=>$count,'status'=>$terminated?'TERMINATED':'IN_PROGRESS','id'=>$attempt['id']]);return['jumlah'=>$count,'terminated'=>$terminated,'duplicate'=>false];});}
}

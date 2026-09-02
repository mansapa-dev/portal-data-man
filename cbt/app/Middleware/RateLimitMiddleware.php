<?php
declare(strict_types=1);
namespace Cbt\Middleware;
use Cbt\Core\{Request,Response};
use PDO;
final class RateLimitMiddleware
{
 public function __construct(private PDO$db,private string$bucket,private int$maximum=10,private int$windowSeconds=300){}
 public function __invoke(Request$r,callable$next):Response
 {
  $key=hash('sha256',$this->bucket.'|'.$r->ip());$this->db->beginTransaction();try{$s=$this->db->prepare('SELECT * FROM rate_limits WHERE bucket_key=:key FOR UPDATE');$s->execute(['key'=>$key]);$row=$s->fetch();$now=time();if($row&&$row['blocked_until']&&strtotime($row['blocked_until'].' UTC')>$now){$this->db->commit();return Response::error('Terlalu banyak percobaan. Coba lagi beberapa saat.',429);}$started=$row?strtotime($row['window_started_at'].' UTC'):0;$attempts=$row&&($now-$started)<$this->windowSeconds?(int)$row['attempts']+1:1;$windowStart=$attempts===1?gmdate('Y-m-d H:i:s'):$row['window_started_at'];$blocked=$attempts>$this->maximum?gmdate('Y-m-d H:i:s',$now+$this->windowSeconds):null;$q=$this->db->prepare('INSERT INTO rate_limits(bucket_key,attempts,window_started_at,blocked_until) VALUES(:key,:attempts,:started,:blocked) ON DUPLICATE KEY UPDATE attempts=VALUES(attempts),window_started_at=VALUES(window_started_at),blocked_until=VALUES(blocked_until)');$q->execute(['key'=>$key,'attempts'=>$attempts,'started'=>$windowStart,'blocked'=>$blocked]);$this->db->commit();if($blocked)return Response::error('Terlalu banyak percobaan. Coba lagi beberapa saat.',429);}catch(\Throwable$e){if($this->db->inTransaction())$this->db->rollBack();throw$e;}return$next($r);
 }
}

<?php
namespace App\Infrastructure\Security;
use App\Infrastructure\Database\Connection;
final class RateLimiter
{
    public function __construct(private readonly Connection $database){}
    public function attempt(string $key,int $maximum,int $windowSeconds,int $blockSeconds=60):bool
    {
        $hash=hash('sha256',$key);$pdo=$this->database->pdo();$pdo->beginTransaction();try{$query=$pdo->prepare('SELECT attempts,window_started_at,blocked_until FROM rate_limits WHERE limiter_key=:key FOR UPDATE');$query->execute(['key'=>$hash]);$row=$query->fetch();$now=time();if($row&&$row['blocked_until']&&strtotime($row['blocked_until'])>$now){$pdo->commit();return false;}$attempts=1;$started=date('Y-m-d H:i:s');if($row&&strtotime($row['window_started_at'])+$windowSeconds>$now){$attempts=(int)$row['attempts']+1;$started=$row['window_started_at'];}$blocked=$attempts>$maximum?date('Y-m-d H:i:s',$now+$blockSeconds):null;$statement=$pdo->prepare('INSERT INTO rate_limits(limiter_key,attempts,window_started_at,blocked_until) VALUES(:key,:attempts,:started,:blocked) ON DUPLICATE KEY UPDATE attempts=VALUES(attempts),window_started_at=VALUES(window_started_at),blocked_until=VALUES(blocked_until)');$statement->execute(['key'=>$hash,'attempts'=>$attempts,'started'=>$started,'blocked'=>$blocked]);$pdo->commit();return $blocked===null;}catch(\Throwable $error){$pdo->rollBack();throw $error;}
    }
}

<?php
declare(strict_types=1);
namespace Cbt\Middleware;

use Cbt\Core\{RedisCache,Request,Response};
use PDO;

final class RateLimitMiddleware
{
 public function __construct(private PDO$db,private string$bucket,private int$maximum=10,private int$windowSeconds=300){}
 public function bucketKey(Request $request): string
 {
  $identity = match ($this->bucket) {
   'student-login' => preg_replace('/\s+/', '', trim((string)$request->input('nisn', ''))),
   'staff-login' => strtolower(trim((string)$request->input('username', ''))),
   'support-ticket' => (string)($_SESSION['student']['student_id'] ?? preg_replace('/\s+/', '', trim((string)$request->input('nisn', '')))).'|'.$request->ip(),
   'submit', 'violation' => (string)($_SESSION['student']['student_id'] ?? 'anonymous').'|'.(string)($request->attributes['id'] ?? ''),
   default => $request->ip(),
  };
  return hash('sha256', $this->bucket.'|'.$identity);
 }
 public function __invoke(Request$r,callable$next):Response
 {
  $key=$this->bucketKey($r);
  $redisLimit=RedisCache::consumeRateLimit('rate-limit:'.$key,$this->maximum,$this->windowSeconds);
  if($redisLimit!==null){
   if(!$redisLimit['allowed'])return Response::error('Terlalu banyak percobaan. Coba lagi beberapa saat.',429);
   return$next($r);
  }
  // MySQL fallback stays atomic without a long explicit locking transaction
  // while PHP calculates the window. This greatly shortens the
  // shared-row lock when Redis is unavailable on shared hosting.
  $now=time();$cutoff=gmdate('Y-m-d H:i:s',$now-$this->windowSeconds);$blockedUntil=gmdate('Y-m-d H:i:s',$now+$this->windowSeconds);
  $q=$this->db->prepare('INSERT INTO rate_limits(bucket_key,attempts,window_started_at,blocked_until) VALUES(:key,1,UTC_TIMESTAMP(3),NULL) ON DUPLICATE KEY UPDATE attempts=IF(window_started_at<=:cutoff_attempts,1,attempts+1),window_started_at=IF(window_started_at<=:cutoff_window,UTC_TIMESTAMP(3),window_started_at),blocked_until=IF(blocked_until>UTC_TIMESTAMP(3),blocked_until,IF(attempts>:maximum,:blocked,NULL))');
  $q->execute(['key'=>$key,'cutoff_attempts'=>$cutoff,'cutoff_window'=>$cutoff,'maximum'=>$this->maximum,'blocked'=>$blockedUntil]);
  $s=$this->db->prepare('SELECT blocked_until FROM rate_limits WHERE bucket_key=:key');$s->execute(['key'=>$key]);$blocked=$s->fetchColumn();
  if($blocked!==false&&$blocked!==null&&strtotime((string)$blocked.' UTC')>$now)return Response::error('Terlalu banyak percobaan. Coba lagi beberapa saat.',429);
  return$next($r);
 }
}

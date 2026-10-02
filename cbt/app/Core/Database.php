<?php
declare(strict_types=1);
namespace Cbt\Core;
use PDO;
final class Database
{
 private PDO $pdo;
 public function __construct()
 {
  $dsn=sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',Config::get('DB_HOST','127.0.0.1'),Config::get('DB_PORT','3306'),Config::get('DB_DATABASE'));
  $this->pdo=new PDO($dsn,(string)Config::get('DB_USERNAME'),(string)Config::get('DB_PASSWORD'),[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false]);
  $this->pdo->exec("SET time_zone = '+00:00'");
 }
 public function pdo():PDO{return $this->pdo;}
 public function transaction(callable $callback, ?TransactionProfile $profile=null):mixed
 {
  // An explicit null means the caller already decided not to sample.
  $owned=func_num_args()<2;
  if($owned)$profile=TransactionProfile::sample('transaction');
  $started=hrtime(true);$outcome='error';
  try{
   for($retry=0;;$retry++){
    $this->pdo->beginTransaction();
    try{
     $result=$callback($this->pdo);
     if($profile)$profile->measure('commit_ms',fn()=>$this->pdo->commit());else $this->pdo->commit();
     $outcome='committed';return $result;
    }catch(\Throwable $error){
     if($this->pdo->inTransaction())$this->pdo->rollBack();
     if($error instanceof \PDOException && in_array((int)($error->errorInfo[1]??0),[1205,1213],true) && $retry<2){$profile?->add('retries',1);usleep(random_int(10000,40000));continue;}
     throw $error;
    }
   }
  }finally{
   $profile?->add('transaction_total_ms',(hrtime(true)-$started)/1e6);
   if($owned)$profile?->finish($outcome);
  }
 }
}

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
 public function transaction(callable $callback):mixed
 {
  for($retry=0;;$retry++){
   $this->pdo->beginTransaction();
   try{$result=$callback($this->pdo);$this->pdo->commit();return $result;}
   catch(\Throwable $error){
    if($this->pdo->inTransaction())$this->pdo->rollBack();
    if($error instanceof \PDOException && in_array((int)($error->errorInfo[1]??0),[1205,1213],true) && $retry<2){usleep(random_int(10000,40000));continue;}
    throw $error;
   }
  }
 }
}

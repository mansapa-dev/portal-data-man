<?php
declare(strict_types=1);
namespace Cbt\Core {
    function error_log(string $message): bool {
        if (!empty($GLOBALS['cbt_test_logger_failure'])) throw new \RuntimeException('logger unavailable');
        return \error_log($message);
    }
}
namespace {
require dirname(__DIR__).'/app/Core/Config.php';
require dirname(__DIR__).'/app/Core/TransactionProfile.php';
require dirname(__DIR__).'/app/Core/Database.php';
// Fault injection tests complement the real MySQL 1205 test in contention-runner.
// Verify both retry codes, rollback of partial work, the retry bound, and a
// failed logger never converting a committed write into an error response.
final class RetryTestPdo extends PDO
{
    public int $committed=0, $pending=0, $begins=0, $rollbacks=0;
    private bool $active=false;
    public function __construct() {}
    public function beginTransaction(): bool {$this->begins++;$this->active=true;$this->pending=$this->committed;return true;}
    public function inTransaction(): bool {return $this->active;}
    public function commit(): bool {$this->committed=$this->pending;$this->active=false;return true;}
    public function rollBack(): bool {$this->rollbacks++;$this->active=false;$this->pending=$this->committed;return true;}
}
$assert=static function(bool $ok,string $name):void{if(!$ok)throw new RuntimeException($name);echo 'PASS '.$name."\n";};
$build=static function():array{
    $pdo=new RetryTestPdo();$class=new ReflectionClass(Cbt\Core\Database::class);
    $db=$class->newInstanceWithoutConstructor();$class->getProperty('pdo')->setValue($db,$pdo);return[$db,$pdo];
};
$error=static function(int $code):PDOException{$e=new PDOException('injected retry');$e->errorInfo=['HY000',$code,'injected'];return$e;};
$_ENV['CBT_PROFILE_SAMPLE_RATE']='0';
foreach([1205,1213]as$code){
    [$db,$pdo]=$build();$calls=0;
    $result=$db->transaction(function($connection)use(&$calls,$code,$error){$connection->pending++;if(++$calls===1)throw$error($code);return'accepted';});
    $assert($result==='accepted'&&$pdo->committed===1&&$pdo->rollbacks===1&&$calls===2,"$code rolls back partial work before retry");
    [$db,$pdo]=$build();$caught=false;
    try{$db->transaction(function($connection)use($code,$error){$connection->pending++;throw$error($code);});}catch(PDOException){$caught=true;}
    $assert($caught&&$pdo->begins===3&&$pdo->rollbacks===3&&$pdo->committed===0,"$code stops after three attempts with no partial commit");
}
[$db,$pdo]=$build();
try{$db->transaction(function($connection){$connection->pending++;throw new RuntimeException('validation');});}catch(RuntimeException){}
$assert($pdo->begins===1&&$pdo->rollbacks===1&&$pdo->committed===0,'non-PDO error is not retried');
$assert(Cbt\Core\TransactionProfile::sample('test')===null,'profiling disabled by default setting');
$_ENV['CBT_PROFILE_SAMPLE_RATE']='1';
$profile=Cbt\Core\TransactionProfile::sample('test');
$reflection=new ReflectionClass($profile);$fields=$reflection->getProperty('timings');
$profile->measure('answer_write_ms',fn()=>42);
$assert(array_keys($fields->getValue($profile))===['answer_write_ms'],'profile stores phase timing only');
// Inject a throwing logger through PHP's namespace function resolution.
$GLOBALS['cbt_test_logger_failure']=true;
try{[$db,$pdo]=$build();$value=$db->transaction(function($connection){$connection->pending++;return'ok';});}
finally{unset($GLOBALS['cbt_test_logger_failure']);}
$assert($value==='ok'&&$pdo->committed===1,'logging failure cannot undo or reject committed save');
}

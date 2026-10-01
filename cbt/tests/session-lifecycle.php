<?php
declare(strict_types=1);
// No bootstrap/.env: exercise PHP session failures with an isolated handler.
require dirname(__DIR__).'/app/Core/Config.php';
require dirname(__DIR__).'/app/Exceptions/DomainException.php';
require dirname(__DIR__).'/app/Core/Session.php';

final class TestSessionHandler implements SessionHandlerInterface
{
 public bool $failRead=false;
 public string $saved='';
 public function open(string $path,string $name):bool{return true;}
 public function close():bool{return true;}
 public function read(string $id):string|false{return $this->failRead?false:$this->saved;}
 public function write(string $id,string $data):bool{$this->saved=$data;return true;}
 public function destroy(string $id):bool{return true;}
 public function gc(int $max_lifetime):int|false{return 0;}
}
$handler=new TestSessionHandler();
session_set_save_handler($handler,true);
\Cbt\Core\Session::start();
$token=\Cbt\Core\Session::csrf();
if(strlen($token)!==64)throw new RuntimeException('Missing CSRF token');
$_SESSION['student']=['student_id'=>1];
\Cbt\Core\Session::close();
if(session_status()===PHP_SESSION_ACTIVE||!str_contains($handler->saved,'student_id'))throw new RuntimeException('Login session not persisted/released');
\Cbt\Core\Session::start();
if(\Cbt\Core\Session::csrf()!==$token)throw new RuntimeException('Token changed after reopening');
\Cbt\Core\Session::close();
$handler->failRead=true;
$rejected=false;
try{@\Cbt\Core\Session::start();}catch(\Cbt\Exceptions\DomainException $e){$rejected=$e->status===503;}
if(!$rejected||session_status()===PHP_SESSION_ACTIVE)throw new RuntimeException('Failed session read was accepted');
echo "PASS session persists login, releases lock, preserves token and rejects failed reads\n";

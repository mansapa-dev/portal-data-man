<?php
declare(strict_types=1);
require dirname(__DIR__).'/bootstrap.php';
use Cbt\Core\{Config,Database};
$errors=[];$warnings=[];$ok=[];
$check=function(bool$condition,string$message,bool$warning=false)use(&$errors,&$warnings,&$ok):void{if($condition)$ok[]=$message;elseif($warning)$warnings[]=$message;else$errors[]=$message;};
$check(version_compare(PHP_VERSION,'8.2.0','>='),'PHP 8.2+');
foreach(['pdo','pdo_mysql','curl','openssl','json','mbstring','fileinfo','zip']as$extension)$check(extension_loaded($extension),"Extension {$extension}");
foreach(['APP_URL','APP_KEY','DB_HOST','DB_DATABASE','DB_USERNAME','PORTAL_DATA_BASE_URL','PORTAL_DATA_SYNC_CLIENT_ID','PORTAL_DATA_SYNC_CLIENT_SECRET']as$key)$check((string)Config::get($key)!=='',"Environment {$key}");
$check(strlen((string)Config::get('APP_KEY'))>=32,'APP_KEY minimal 32 karakter');
$check(strlen((string)Config::get('PORTAL_DATA_SYNC_CLIENT_SECRET'))>=32,'PORTAL_DATA_SYNC_CLIENT_SECRET minimal 32 karakter');
$check(!Config::bool('APP_DEBUG',true),'APP_DEBUG=false');$check(Config::bool('SESSION_SECURE_COOKIE',false),'Secure session cookie');
foreach(['storage/logs','storage/cache','storage/imports']as$directory){$path=dirname(__DIR__).'/'.$directory;$check(is_dir($path)&&is_writable($path),"Writable {$directory}");}
try{(new Database())->pdo()->query('SELECT 1');$ok[]='Koneksi database CBT';}catch(Throwable$e){$errors[]='Koneksi database CBT gagal: '.$e->getMessage();}
$url=(string)Config::get('PORTAL_DATA_BASE_URL');$check(str_starts_with($url,'https://'),'Portal Data memakai HTTPS',true);
foreach($ok as$message)echo"PASS {$message}\n";foreach($warnings as$message)echo"WARN {$message}\n";foreach($errors as$message)echo"FAIL {$message}\n";
echo sprintf("\n%d pass, %d warning, %d fail.\n",count($ok),count($warnings),count($errors));exit($errors?1:0);

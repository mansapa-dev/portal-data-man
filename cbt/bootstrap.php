<?php
declare(strict_types=1);
use Cbt\Core\{Config,Session};
$root=__DIR__;
if(is_file($root.'/vendor/autoload.php'))require$root.'/vendor/autoload.php';else spl_autoload_register(function(string$class)use($root){$prefix='Cbt\\';if(str_starts_with($class,$prefix)){$file=$root.'/app/'.str_replace('\\','/',substr($class,strlen($prefix))).'.php';if(is_file($file))require$file;}});
if(class_exists(Dotenv\Dotenv::class)&&is_file($root.'/.env'))Dotenv\Dotenv::createImmutable($root)->safeLoad();
date_default_timezone_set((string)Config::get('APP_TIMEZONE','Asia/Jakarta'));Session::start();
set_exception_handler(function(Throwable$e):never{$dir=__DIR__.'/storage/logs';if(!is_dir($dir))mkdir($dir,0775,true);error_log(sprintf("[%s] %s\n%s\n",date(DATE_ATOM),$e->getMessage(),$e->getTraceAsString()),3,$dir.'/app.log');$status=$e instanceof Cbt\Exceptions\DomainException?$e->status:500;$debug=Config::bool('APP_DEBUG');$message=$status<500||$debug?$e->getMessage():'Terjadi kesalahan pada sistem.';Cbt\Core\Response::error($message,$status)->send();});

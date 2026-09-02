<?php
declare(strict_types=1);
namespace Cbt\Core;
final class Session
{
 public static function start():void
 {
  if(session_status()===PHP_SESSION_ACTIVE)return;
  $lifetime=max(900,(int)Config::get('SESSION_LIFETIME',7200));
  $https=(!empty($_SERVER['HTTPS'])&&strtolower((string)$_SERVER['HTTPS'])!=='off')||((string)($_SERVER['HTTP_X_FORWARDED_PROTO']??'')==='https');
  $sameSite=(string)Config::get('SESSION_SAME_SITE','Lax');if(!in_array($sameSite,['Lax','Strict','None'],true))$sameSite='Lax';
  ini_set('session.gc_maxlifetime',(string)$lifetime);ini_set('session.use_strict_mode','1');ini_set('session.use_only_cookies','1');
  session_name('cbt_session');session_set_cookie_params(['lifetime'=>$lifetime,'path'=>'/','secure'=>Config::bool('SESSION_SECURE_COOKIE',true)&&$https,'httponly'=>true,'samesite'=>$sameSite]);
  session_start();if(!isset($_SESSION['csrf']))$_SESSION['csrf']=bin2hex(random_bytes(32));
 }
 public static function regenerate():void{session_regenerate_id(true);}
 public static function csrf():string{return(string)($_SESSION['csrf']??'');}
 public static function destroy():void{$_SESSION=[];if(ini_get('session.use_cookies')){$p=session_get_cookie_params();setcookie(session_name(),'',time()-42000,$p['path'],$p['domain'],$p['secure'],$p['httponly']);}session_destroy();}
}

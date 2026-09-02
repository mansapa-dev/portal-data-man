<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Request,Response,Session};
use Cbt\Services\AuthService;
final class AuthController
{
 public function __construct(private AuthService$auth){}
 public function studentLogin(Request$r):Response{return Response::json($this->auth->studentLogin((string)$r->input('nisn'),(string)$r->input('pin')),'Login berhasil.');}
 public function staffLogin(Request$r):Response{return Response::json($this->auth->staffLogin((string)$r->input('username'),(string)$r->input('password')),'Login berhasil.');}
 public function teacherLogin(Request$r):Response{return Response::json($this->auth->teacherLogin((string)$r->input('nip'),(string)$r->input('password')),'Login guru berhasil.');}
 public function me(Request$r):Response{return Response::json(['student'=>$_SESSION['student']??null,'staff'=>$_SESSION['auth']??null,'csrf_token'=>Session::csrf()]);}
 public function logout(Request$r):Response{Session::destroy();return Response::json(null,'Logout berhasil.');}
 public function changePassword(Request$r):Response{$this->auth->changePassword((int)$_SESSION['auth']['user_id'],(string)$r->input('old_password'),(string)$r->input('new_password'));return Response::json(null,'Password berhasil diperbarui.');}
}

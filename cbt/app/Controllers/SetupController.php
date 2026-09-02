<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Config,Database,Request,Response};
use Cbt\Exceptions\DomainException;
final class SetupController
{
 public function __construct(private Database$db){}
 public function create(Request$r):Response
 {
  $expected=(string)Config::get('SETUP_TOKEN');$token=(string)$r->input('setup_token');
  if($expected===''||!hash_equals($expected,$token))throw new DomainException('Setup token tidak valid.',403);
  if((int)$this->db->pdo()->query("SELECT COUNT(*) FROM users WHERE role='ADMIN'")->fetchColumn()>0)throw new DomainException('Initial admin sudah pernah dibuat.',409);
  $username=trim((string)$r->input('username'));$name=trim((string)$r->input('name'));$password=(string)$r->input('password');
  if(!preg_match('/^[A-Za-z0-9._-]{4,100}$/',$username)||$name===''||strlen($password)<12)throw new DomainException('Username minimal 4 karakter dan password minimal 12 karakter.',422);
  $hash=password_hash($password,defined('PASSWORD_ARGON2ID')?PASSWORD_ARGON2ID:PASSWORD_DEFAULT);
  $statement=$this->db->pdo()->prepare("INSERT INTO users(username,password_hash,name,role,status) VALUES(:username,:hash,:name,'ADMIN','ACTIVE')");$statement->execute(compact('username','hash','name'));
  return Response::json(['user_id'=>(int)$this->db->pdo()->lastInsertId()],'Admin awal berhasil dibuat. Hapus SETUP_TOKEN dari .env sekarang.',201);
 }
}

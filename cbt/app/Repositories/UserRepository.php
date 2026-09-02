<?php
declare(strict_types=1);
namespace Cbt\Repositories;
use PDO;
final class UserRepository
{
    public function __construct(private PDO $db) {}
    public function findActiveByUsername(string $username): ?array
    {
        $statement = $this->db->prepare("SELECT * FROM users WHERE username = :username AND status = 'ACTIVE' LIMIT 1");
        $statement->execute(['username' => $username]);
        return $statement->fetch() ?: null;
    }
    public function findActiveTeacherByNip(string$nip):?array
    {
        $statement=$this->db->prepare("SELECT u.*,t.nip,t.portal_teacher_id,t.name_snapshot teacher_name FROM users u JOIN teachers t ON t.id=u.teacher_id WHERE t.nip=:nip AND t.status='ACTIVE' AND u.role='TEACHER' AND u.status='ACTIVE' LIMIT 1");$statement->execute(['nip'=>$nip]);return$statement->fetch()?:null;
    }
    public function touchLogin(int $id): void
    {
        $statement = $this->db->prepare('UPDATE users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = :id');
        $statement->execute(['id' => $id]);
    }
    public function findById(int$id):?array{$statement=$this->db->prepare('SELECT * FROM users WHERE id=:id LIMIT 1');$statement->execute(['id'=>$id]);return$statement->fetch()?:null;}
    public function updatePassword(int$id,string$hash):void{$statement=$this->db->prepare('UPDATE users SET password_hash=:hash WHERE id=:id');$statement->execute(compact('id','hash'));}
}

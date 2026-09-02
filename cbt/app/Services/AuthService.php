<?php
declare(strict_types=1);
namespace Cbt\Services;
use Cbt\Exceptions\DomainException;
use Cbt\Repositories\{StudentRepository,UserRepository};
use Cbt\Core\Session;
final class AuthService
{
    public function __construct(private StudentRepository $students, private UserRepository $users) {}
    public function studentLogin(string $nisn, string $pin): array
    {
        $nisn=preg_replace('/\s+/','',trim($nisn)) ?? '';
        if(!preg_match('/^\d{8,20}$/',$nisn) || $pin==='') throw new DomainException('NISN atau PIN tidak valid.',422);
        $student=$this->students->findActiveByNisn($nisn);
        if(!$student || $student['cbt_status']!=='ACTIVE' || !$student['pin_hash'] || !password_verify($pin,$student['pin_hash'])) throw new DomainException('NISN atau PIN salah.',401);
        Session::regenerate();
        unset($_SESSION['auth']);
        $_SESSION['student']=['student_id'=>(int)$student['id'],'portal_student_id'=>$student['portal_student_id'],'nisn'=>$student['nisn']];
        return ['nisn'=>$student['nisn'],'nama'=>$student['name_snapshot'],'kelas'=>$student['class_snapshot'],'tingkat'=>$student['grade_snapshot']];
    }
    public function staffLogin(string $username,string $password):array
    {
        $user=$this->users->findActiveByUsername(trim($username));
        if(!$user || $user['role']!=='ADMIN' || !password_verify($password,$user['password_hash'])) throw new DomainException('Username atau password administrator salah.',401);
        Session::regenerate();unset($_SESSION['student']);$_SESSION['auth']=['user_id'=>(int)$user['id'],'teacher_id'=>$user['teacher_id']?(int)$user['teacher_id']:null,'role'=>$user['role']];
        $this->users->touchLogin((int)$user['id']);
        return ['id'=>(int)$user['id'],'nama'=>$user['name'],'username'=>$user['username'],'role'=>strtolower($user['role'])];
    }
    public function sessionState():array
    {
        $student=null;$staff=null;
        if(isset($_SESSION['student']['nisn'],$_SESSION['student']['student_id'])){
            $row=$this->students->findActiveByNisn((string)$_SESSION['student']['nisn']);
            if($row&&(int)$row['id']===(int)$_SESSION['student']['student_id']&&$row['cbt_status']==='ACTIVE')$student=['id'=>(int)$row['id'],'nisn'=>$row['nisn'],'nama'=>$row['name_snapshot'],'kelas'=>$row['class_snapshot'],'tingkat'=>$row['grade_snapshot']];else unset($_SESSION['student']);
        }
        if(isset($_SESSION['auth']['user_id'],$_SESSION['auth']['role'])){
            $row=$this->users->findById((int)$_SESSION['auth']['user_id']);
            if($row&&$row['status']==='ACTIVE'&&hash_equals((string)$row['role'],(string)$_SESSION['auth']['role']))$staff=['id'=>(int)$row['id'],'nama'=>$row['name'],'username'=>$row['username'],'role'=>$row['role'],'nip'=>$_SESSION['auth']['nip']??null];else unset($_SESSION['auth']);
        }
        return['student'=>$student,'staff'=>$staff];
    }
    public function changePassword(int$userId,string$old,string$new):void
    {
        $user=$this->users->findById($userId)??throw new DomainException('Akun tidak ditemukan.',404);
        if(!password_verify($old,$user['password_hash']))throw new DomainException('Password lama salah.',422);
        if(strlen($new)<12)throw new DomainException('Password baru minimal 12 karakter.',422);
        $this->users->updatePassword($userId,password_hash($new,defined('PASSWORD_ARGON2ID')?PASSWORD_ARGON2ID:PASSWORD_DEFAULT));
    }
}

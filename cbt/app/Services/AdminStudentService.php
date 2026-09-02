<?php
declare(strict_types=1);
namespace Cbt\Services;
use Cbt\Core\Database;
use Cbt\Exceptions\DomainException;
use Cbt\Repositories\AdminStudentRepository;
use Cbt\Support\SecretCipher;
final class AdminStudentService
{
 public function __construct(private Database$db,private AdminStudentRepository$students,private SecretCipher$cipher){}
 public function all():array{return array_map(function($s){return['id'=>(int)$s['id'],'nomor_ujian'=>$s['nisn'],'nisn'=>$s['nisn'],'nama'=>$s['name_snapshot'],'kelas'=>$s['class_snapshot'],'tingkat'=>$s['grade_snapshot'],'pin'=>$this->cipher->decrypt($s['pin_encrypted'])??'BELUM DISET','tahun_ajaran'=>$s['academic_year_snapshot'],'status_aktif'=>(bool)$s['is_active'],'ujian_status'=>$s['ujian_status'],'last_synced_at'=>$s['last_synced_at']];},$this->students->all());}
 public function setPin(array$d):void{$id=(int)($d['id']??0);$student=$this->students->find($id);if(!$student)throw new DomainException('Siswa harus disinkronkan dari Portal Data terlebih dahulu.',404);if(isset($d['nomor_ujian'])&&!hash_equals($student['nisn'],trim((string)$d['nomor_ujian'])))throw new DomainException('NISN tidak dapat diubah dari CBT. Ubah melalui Portal Data lalu sinkronkan.',409);$pin=trim((string)($d['pin']??''));if(!preg_match('/^\d{4,12}$/',$pin))throw new DomainException('PIN harus berupa 4–12 digit.',422);$hash=password_hash($pin,defined('PASSWORD_ARGON2ID')?PASSWORD_ARGON2ID:PASSWORD_DEFAULT);$encrypted=$this->cipher->encrypt($pin);$this->students->setPin($id,$hash,$encrypted);}
 public function reset(int$id):void{$this->db->transaction(fn()=>$this->students->resetAttempts($id));}
}

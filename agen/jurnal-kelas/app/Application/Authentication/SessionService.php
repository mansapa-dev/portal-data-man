<?php
namespace App\Application\Authentication;
use App\Infrastructure\Database\Connection;
use App\Support\Config;
use App\Support\Ulid;
final class SessionService
{
    public function __construct(private readonly Connection $database, private readonly Config $config) {}
    public function register(int $userId, array $server): string
    {
        $publicId=Ulid::generate(); $lifetime=(int)$this->config->get('auth.session_lifetime',7200);
        $statement=$this->database->pdo()->prepare('INSERT INTO user_sessions(public_id,user_id,token_hash,csrf_token_hash,ip_address,user_agent,last_used_at,expires_at) VALUES(:public_id,:user_id,:token_hash,:csrf_hash,:ip,:agent,NOW(3),DATE_ADD(NOW(3),INTERVAL :lifetime SECOND))');
        $statement->bindValue('public_id',$publicId); $statement->bindValue('user_id',$userId,\PDO::PARAM_INT); $statement->bindValue('token_hash',hash('sha256',session_id())); $statement->bindValue('csrf_hash',hash('sha256',(string)($_SESSION['csrf_token']??''))); $statement->bindValue('ip',substr((string)($server['REMOTE_ADDR']??''),0,45)?:null); $statement->bindValue('agent',substr((string)($server['HTTP_USER_AGENT']??''),0,500)?:null); $statement->bindValue('lifetime',$lifetime,\PDO::PARAM_INT); $statement->execute(); return $publicId;
    }
    public function validate(string $publicId): bool
    {
        $statement=$this->database->pdo()->prepare('SELECT id,token_hash,csrf_token_hash FROM user_sessions WHERE public_id=:public_id AND revoked_at IS NULL AND expires_at>NOW(3) LIMIT 1'); $statement->execute(['public_id'=>$publicId]); $session=$statement->fetch();
        if(!$session||!hash_equals($session['token_hash'],hash('sha256',session_id()))||!hash_equals($session['csrf_token_hash'],hash('sha256',(string)($_SESSION['csrf_token']??'')))) return false;
        $this->database->pdo()->prepare('UPDATE user_sessions SET last_used_at=NOW(3) WHERE id=:id')->execute(['id'=>$session['id']]); return true;
    }
    public function revoke(?string $publicId): void { if($publicId)$this->database->pdo()->prepare('UPDATE user_sessions SET revoked_at=NOW(3) WHERE public_id=:public_id AND revoked_at IS NULL')->execute(['public_id'=>$publicId]); }
}

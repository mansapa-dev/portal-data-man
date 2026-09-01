<?php
namespace App\Http\Controllers;
use App\Application\Authentication\AuthProvider;
use App\Application\Authentication\SessionService;
use App\Http\Request;
use App\Http\Response;
use App\Infrastructure\Database\Connection;
use App\Infrastructure\PortalData\PortalDataClient;
use App\Support\Ulid;
use Throwable;
final class AuthController
{
    public function __construct(private readonly AuthProvider $auth, private readonly Connection $database, private readonly PortalDataClient $portal, private readonly SessionService $sessions) {}
    public function login(Request $request): Response { if (isset($_SESSION['user'])) return Response::redirect('/dashboard'); ob_start(); require dirname(__DIR__, 3).'/resources/views/auth/login.php'; return Response::html((string) ob_get_clean()); }
    public function redirect(Request $request): Response { return Response::redirect($this->auth->authorizationUrl()); }
    public function callback(Request $request): Response
    {
        $code=(string)$request->input('code',''); $state=(string)$request->input('state',''); if($code===''||$state==='') return Response::redirect('/login?error=callback');
        try { $result=$this->auth->authenticateCallback($code,$state); $user=$this->synchronizeUser($result['user']); session_regenerate_id(true); $_SESSION['csrf_token']=bin2hex(random_bytes(32)); $_SESSION['user']=$user; $_SESSION['portal_access_token']=$result['access_token']; $_SESSION['portal_access_expires_at']=$result['expires_at']; $_SESSION['portal_reference']=['classes'=>$this->portal->classes($result['access_token']),'periods'=>$this->portal->periods($result['access_token']),'synced_at'=>time()]; $_SESSION['auth_session_public_id']=$this->sessions->register($user['id'],$request->server); return Response::redirect('/dashboard'); }
        catch(Throwable $error){ error_log('OIDC callback gagal: '.$error->getMessage()); return Response::redirect('/login?error=oidc'); }
    }
    public function logout(Request $request): Response
    {
        $url=$this->auth->logoutUrl(bin2hex(random_bytes(16))); $this->sessions->revoke($_SESSION['auth_session_public_id']??null); $_SESSION=[]; if(ini_get('session.use_cookies')){$p=session_get_cookie_params();setcookie(session_name(),'',time()-42000,$p['path'],$p['domain'],$p['secure'],$p['httponly']);} session_destroy(); return Response::redirect($url);
    }
    private function synchronizeUser(array $claims): array
    {
        $portalId=(string)($claims['portal_teacher_id']??''); if(!preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/',$portalId)) throw new \RuntimeException('Public ID guru Portal Data tidak valid.');
        $role=(string)($claims['portal_role']??'');if(!in_array($role,['TEACHER','ADMIN','AUDITOR'],true))throw new \RuntimeException('Role aplikasi tidak valid.');
        $pdo=$this->database->pdo(); $find=$pdo->prepare('SELECT public_id FROM users WHERE portal_teacher_public_id = :portal_id LIMIT 1'); $find->execute(['portal_id'=>$portalId]); $publicId=$find->fetchColumn()?:Ulid::generate();
        $pdo->prepare("INSERT INTO users(public_id,portal_teacher_public_id,name_snapshot,email_snapshot,role,status,last_login_at) VALUES(:public_id,:portal_id,:name,:email,:role,'ACTIVE',NOW(3)) ON DUPLICATE KEY UPDATE name_snapshot=VALUES(name_snapshot),email_snapshot=VALUES(email_snapshot),role=VALUES(role),status='ACTIVE',last_login_at=NOW(3)")->execute(['public_id'=>$publicId,'portal_id'=>$portalId,'name'=>(string)$claims['name'],'email'=>$claims['email']??null,'role'=>$role]);
        $identity=$pdo->prepare('SELECT id,public_id FROM users WHERE portal_teacher_public_id=:portal_id LIMIT 1'); $identity->execute(['portal_id'=>$portalId]); $local=$identity->fetch();
        return ['id'=>(int)$local['id'],'public_id'=>$local['public_id'],'portal_teacher_public_id'=>$portalId,'name'=>(string)$claims['name'],'email'=>$claims['email']??null,'username'=>(string)($claims['preferred_username']??''),'role'=>$role];
    }
}

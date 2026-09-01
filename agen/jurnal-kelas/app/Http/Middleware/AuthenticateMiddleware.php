<?php
namespace App\Http\Middleware;
use App\Application\Authentication\SessionService;
use App\Http\Request;
use App\Http\Response;
use Closure;
final class AuthenticateMiddleware
{
    public function __construct(private readonly SessionService $sessions) {}
    public function handle(Request $request,Closure $next):Response
    {
        $valid=isset($_SESSION['user'],$_SESSION['auth_session_public_id'])&&$this->sessions->validate((string)$_SESSION['auth_session_public_id']);
        if(!$valid){$_SESSION=[];return str_starts_with($request->path,'/api/')?Response::json(['success'=>false,'message'=>'Sesi tidak valid atau telah berakhir.'],401):Response::redirect('/login');}
        return $next($request);
    }
}

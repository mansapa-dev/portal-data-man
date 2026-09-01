<?php
namespace App\Http\Middleware;
use App\Http\Request;
use App\Http\Response;
use App\Infrastructure\Security\RateLimiter;
use Closure;
final class ScanRateLimitMiddleware
{
    public function __construct(private readonly RateLimiter $limiter){}
    public function handle(Request $request,Closure $next):Response
    {
        $actor=$_SESSION['user']['public_id']??'anonymous';$ip=$request->server['REMOTE_ADDR']??'unknown';if(!$this->limiter->attempt('barcode:'.$actor.':'.$ip,30,60,60))return Response::json(['success'=>false,'message'=>'Terlalu banyak percobaan scan. Tunggu satu menit.'],429);return $next($request);
    }
}

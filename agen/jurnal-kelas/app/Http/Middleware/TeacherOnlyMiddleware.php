<?php
namespace App\Http\Middleware;
use App\Http\Request;
use App\Http\Response;
use Closure;
final class TeacherOnlyMiddleware
{
    public function handle(Request $request,Closure $next):Response{return ($_SESSION['user']['role']??null)==='TEACHER'?$next($request):Response::json(['success'=>false,'message'=>'Hanya guru yang dapat mengubah data pembelajaran.'],403);}
}

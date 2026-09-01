<?php
namespace App\Http\Middleware;
use App\Http\Request;
use App\Http\Response;
use Closure;
final class AuditAccessMiddleware
{
    public function handle(Request $request,Closure $next):Response{return in_array($_SESSION['user']['role']??null,['ADMIN','AUDITOR'],true)?$next($request):(str_starts_with($request->path,'/api/')?Response::json(['success'=>false,'message'=>'Akses ditolak.'],403):Response::html('<!doctype html><html lang="id"><title>403</title><main><h1>403</h1><p>Anda tidak memiliki akses ke halaman ini.</p><a href="/dashboard">Kembali</a></main>',403));}
}

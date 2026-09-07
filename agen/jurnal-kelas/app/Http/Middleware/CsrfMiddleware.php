<?php
namespace App\Http\Middleware;

use App\Http\Request;
use App\Http\Response;
use Closure;

final class CsrfMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        // Logout browser boleh diproses meski halaman sudah lama terbuka dan
        // token CSRF-nya kedaluwarsa. Logout hanya mengakhiri sesi dan tidak
        // mengubah data, sedangkan endpoint API tetap wajib memakai CSRF.
        if($request->path==='/logout')return $next($request);
        if (in_array($request->method, ['POST', 'PATCH', 'PUT', 'DELETE'], true)) {
            $provided = $request->server['HTTP_X_CSRF_TOKEN'] ?? $request->input('_token', '');
            if (!is_string($provided) || !hash_equals($_SESSION['csrf_token'] ?? '', $provided)) {
                return str_starts_with($request->path,'/api/')
                    ? Response::json(['success' => false, 'message' => 'Sesi keamanan tidak valid. Muat ulang halaman.'], 419)
                    : Response::redirect('/login?error=csrf');
            }
        }
        return $next($request);
    }
}

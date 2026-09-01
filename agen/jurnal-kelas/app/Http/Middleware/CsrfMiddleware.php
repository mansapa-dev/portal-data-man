<?php
namespace App\Http\Middleware;

use App\Http\Request;
use App\Http\Response;
use Closure;

final class CsrfMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        if (in_array($request->method, ['POST', 'PATCH', 'PUT', 'DELETE'], true)) {
            $provided = $request->server['HTTP_X_CSRF_TOKEN'] ?? $request->input('_token', '');
            if (!is_string($provided) || !hash_equals($_SESSION['csrf_token'] ?? '', $provided)) return Response::json(['success' => false, 'message' => 'Sesi keamanan tidak valid. Muat ulang halaman.'], 419);
        }
        return $next($request);
    }
}

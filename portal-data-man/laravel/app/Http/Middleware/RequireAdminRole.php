<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireAdminRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user('admin');
        abort_unless($user && in_array($user->role, $roles, true), 403, 'Anda tidak memiliki izin untuk melakukan tindakan ini.');

        return $next($request);
    }
}

<?php

namespace App\Http\Middleware;

use App\Services\PortalSessionService;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\HttpFoundation\Response;

class RequirePortalSession
{
    public function __construct(private readonly PortalSessionService $sessions) {}

    public function handle(Request $request, Closure $next, string $guard): Response
    {
        if (! Schema::hasTable('AuthSession')) {
            return $next($request);
        }
        if (! $request->session()->has('portal_session_public_id')) {
            $account = $request->user($guard);
            if ($account) {
                $this->sessions->register($request, $account);

                return $next($request);
            }
        }
        if (! $this->sessions->touch($request, $request->user($guard))) {
            Auth::guard($guard)->logout();
            $request->session()->invalidate();
            abort(401, 'Session tidak valid atau telah dicabut.');
        }

        return $next($request);
    }
}

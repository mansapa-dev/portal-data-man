<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireCbtIntegrationKey
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = (string) config('services.cbt.api_key');
        $provided = (string) ($request->header('X-API-Key') ?: $request->bearerToken());
        abort_if($expected === '' || $provided === '' || ! hash_equals($expected, $provided), 401, 'API key integrasi CBT tidak valid.');

        return $next($request);
    }
}

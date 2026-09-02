<?php

namespace App\Http\Middleware;

use App\Models\ApplicationClient;
use App\Services\OidcTokenService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireCbtServiceToken
{
    public function __construct(private readonly OidcTokenService $tokens) {}

    public function handle(Request $request, Closure $next): Response
    {
        $raw = $request->bearerToken();
        $claims = $raw ? $this->tokens->verify($raw) : null;
        $scopes = array_filter(explode(' ', (string) ($claims['scope'] ?? '')));
        $clientId = (string) ($claims['client_id'] ?? '');
        $validClaims = $claims
            && ($claims['token_use'] ?? null) === 'access'
            && ($claims['grant_type'] ?? null) === 'client_credentials'
            && $clientId !== ''
            && hash_equals($clientId, (string) ($claims['sub'] ?? ''))
            && hash_equals($clientId, (string) ($claims['aud'] ?? ''))
            && in_array('portal_data.read', $scopes, true);
        $validClient = $validClaims && ApplicationClient::query()
            ->where('clientId', $clientId)->where('clientType', 'SERVICE')->where('status', 'ACTIVE')
            ->whereJsonContains('allowedGrantTypes', 'client_credentials')
            ->whereJsonContains('allowedScopes', 'portal_data.read')->exists();
        abort_unless($validClient, 401, 'Access token integrasi CBT tidak valid atau kedaluwarsa.');

        return $next($request);
    }
}

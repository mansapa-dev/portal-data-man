<?php
namespace App\Http\Middleware;

use App\Http\Request;
use App\Http\Response;
use App\Support\Config;
use Closure;

final class SecurityHeadersMiddleware
{
    public function __construct(private readonly Config $config) {}
    public function handle(Request $request, Closure $next): Response
    {
        header('Content-Security-Policy: '.$this->config->get('security.csp'));
        header('X-Frame-Options: DENY');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: strict-origin-when-cross-origin');
        header('Permissions-Policy: camera=(self), microphone=(), geolocation=()');
        header('Cross-Origin-Opener-Policy: same-origin');
        header('Cross-Origin-Resource-Policy: same-origin');
        if ($this->config->get('app.env') === 'production' && !empty($request->server['HTTPS'])) header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
        return $next($request);
    }
}

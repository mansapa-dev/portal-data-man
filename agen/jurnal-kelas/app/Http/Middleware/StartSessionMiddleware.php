<?php
namespace App\Http\Middleware;

use App\Http\Request;
use App\Http\Response;
use App\Support\Config;
use Closure;

final class StartSessionMiddleware
{
    public function __construct(private readonly Config $config) {}
    public function handle(Request $request, Closure $next): Response
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            session_name('jurnal_kelas_session');
            $lifetime = (int) $this->config->get('auth.session_lifetime', 31536000);
            ini_set('session.gc_maxlifetime', (string) $lifetime);
            ini_set('session.cookie_lifetime', (string) $lifetime);
            session_set_cookie_params([
                'lifetime' => $lifetime,
                'path' => '/',
                'secure' => (bool) $this->config->get('auth.secure_cookie'),
                'httponly' => true,
                'samesite' => 'Lax'
            ]);
            session_start();
        }
        $_SESSION['csrf_token'] ??= bin2hex(random_bytes(32));
        return $next($request);
    }
}

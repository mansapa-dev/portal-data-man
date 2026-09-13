<?php

declare(strict_types=1);

namespace Cbt\Middleware;

use Cbt\Core\Request;
use Cbt\Core\Response;

final class SessionReleaseMiddleware
{
    public function __invoke(Request $request, callable $next): Response
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }

        return $next($request);
    }
}
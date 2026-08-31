<?php

use App\Http\Middleware\RequireAdminRole;
use App\Http\Middleware\RequirePortalSession;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->encryptCookies(except: ['portal_csrf', 'portal_teacher_csrf']);
        $middleware->alias(['role' => RequireAdminRole::class, 'portal.session' => RequirePortalSession::class]);
        $middleware->validateCsrfTokens(except: ['oidc/token', 'oidc/userinfo', 'oidc/logout']);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();

<?php

declare(strict_types=1);

use App\Http\Middleware\CsrfMiddleware;
use App\Http\Middleware\SecurityHeadersMiddleware;
use App\Http\Middleware\StartSessionMiddleware;
use App\Http\Request;
use App\Http\Response;
use App\Http\Router\Router;
use App\Support\Config;

$container = require dirname(__DIR__).'/bootstrap/app.php';
$router = new Router($container);
$global = [SecurityHeadersMiddleware::class, StartSessionMiddleware::class, CsrfMiddleware::class];
require dirname(__DIR__).'/routes/web.php';
require dirname(__DIR__).'/routes/api.php';
try {
    $request = Request::capture();
    $next = fn (Request $request) => $router->dispatch($request);
    foreach (array_reverse($global) as $middleware) { $current = $next; $next = fn (Request $request) => $container->get($middleware)->handle($request, $current); }
    $next($request)->send();
} catch (Throwable $error) {
    error_log($error->__toString());
    $debug = $container->get(Config::class)->get('app.debug', false);
    $status=$error instanceof LengthException?413:($error instanceof JsonException?400:500);
    $message=$status===413?'Payload terlalu besar.':($status===400?'Payload JSON tidak valid.':($debug?$error->getMessage():'Terjadi kesalahan pada server.'));
    Response::json(['success' => false, 'message' => $message], $status)->send();
}

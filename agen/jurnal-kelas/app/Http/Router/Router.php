<?php
namespace App\Http\Router;

use App\Http\Request;
use App\Http\Response;
use App\Support\Container;

final class Router
{
    private array $routes = [];
    public function __construct(private readonly Container $container) {}
    public function get(string $path, mixed $handler, array $middleware = []): void { $this->add('GET', $path, $handler, $middleware); }
    public function post(string $path, mixed $handler, array $middleware = []): void { $this->add('POST', $path, $handler, $middleware); }
    public function patch(string $path, mixed $handler, array $middleware = []): void { $this->add('PATCH', $path, $handler, $middleware); }
    public function delete(string $path, mixed $handler, array $middleware = []): void { $this->add('DELETE', $path, $handler, $middleware); }
    private function add(string $method, string $path, mixed $handler, array $middleware): void { $this->routes[] = new Route($method, $path, $handler, $middleware); }
    public function dispatch(Request $request): Response
    {
        foreach ($this->routes as $route) {
            if ($route->method !== $request->method) continue;
            $regex = '#^'.preg_replace('/\{([A-Za-z][A-Za-z0-9_]*)\}/', '(?P<$1>[0-9A-HJKMNP-TV-Z]{26})', $route->pattern).'$#';
            if (!preg_match($regex, $request->path, $matches)) continue;
            foreach (array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY) as $key => $value) $request->setAttribute($key, $value);
            $destination = fn (Request $r) => $this->invoke($route->handler, $r);
            foreach (array_reverse($route->middleware) as $middleware) { $next = $destination; $destination = fn (Request $r) => $this->container->get($middleware)->handle($r, $next); }
            return $destination($request);
        }
        return Response::json(['success' => false, 'message' => 'Halaman tidak ditemukan.'], 404);
    }
    private function invoke(mixed $handler, Request $request): Response
    {
        if (is_callable($handler)) return $handler($request);
        [$class, $method] = $handler;
        return $this->container->get($class)->{$method}($request);
    }
}

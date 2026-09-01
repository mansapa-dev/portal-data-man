<?php
namespace App\Http\Router;

final class Route
{
    public function __construct(public string $method, public string $pattern, public mixed $handler, public array $middleware = []) {}
}

<?php
namespace App\Http;

final class Request
{
    private array $attributes = [];
    public function __construct(public readonly string $method, public readonly string $path, public readonly array $query, public readonly array $body, public readonly array $files, public readonly array $server) {}
    public static function capture(): self
    {
        $length=(int)($_SERVER['CONTENT_LENGTH']??0);if($length>11*1024*1024)throw new \LengthException('Payload terlalu besar.');
        $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
        $body = $_POST;
        if (str_contains($contentType, 'application/json')) $body = json_decode(file_get_contents('php://input') ?: '{}', true, 64, JSON_THROW_ON_ERROR);
        $path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
        return new self(strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'), '/'.trim($path, '/'), $_GET, is_array($body) ? $body : [], $_FILES, $_SERVER);
    }
    public function input(string $key, mixed $default = null): mixed { return $this->body[$key] ?? $this->query[$key] ?? $default; }
    public function setAttribute(string $key, mixed $value): void { $this->attributes[$key] = $value; }
    public function attribute(string $key, mixed $default = null): mixed { return $this->attributes[$key] ?? $default; }
}

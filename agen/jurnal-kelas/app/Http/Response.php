<?php
namespace App\Http;

final class Response
{
    public function __construct(private readonly string $content = '', private readonly int $status = 200, private readonly array $headers = []) {}
    public static function json(array $data, int $status = 200): self { return new self(json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), $status, ['Content-Type' => 'application/json; charset=utf-8']); }
    public static function html(string $html, int $status = 200): self { return new self($html, $status, ['Content-Type' => 'text/html; charset=utf-8']); }
    public static function redirect(string $url, int $status = 302): self { return new self('', $status, ['Location' => $url]); }
    public static function download(string $content, string $mime, string $filename): self { return new self($content, 200, ['Content-Type' => $mime, 'Content-Disposition' => 'inline; filename="'.str_replace(['"', "\r", "\n"], '', $filename).'"', 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']); }
    public static function attachment(string $content, string $mime, string $filename): self { return new self($content, 200, ['Content-Type' => $mime, 'Content-Disposition' => 'attachment; filename="'.str_replace(['"', "\r", "\n"], '', $filename).'"', 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']); }
    public function statusCode(): int { return $this->status; }
    public function content(): string { return $this->content; }
    public function headers(): array { return $this->headers; }
    public function send(): never
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) header($name.': '.$value);
        echo $this->content;
        exit;
    }
}

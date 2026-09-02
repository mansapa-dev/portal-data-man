<?php
namespace App\Http;

final class Response
{
    public function __construct(private readonly string $content = '', private readonly int $status = 200, private readonly array $headers = []) {}
    public static function json(array $data, int $status = 200): self { return new self(json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), $status, ['Content-Type' => 'application/json; charset=utf-8']); }
    public static function html(string $html, int $status = 200): self
    {
        $stylesheet = '<link rel="stylesheet" href="/assets/css/ui.css">';
        if (!str_contains($html, '/assets/css/ui.css')) $html = str_replace('</head>', $stylesheet.'</head>', $html);
        if (!str_contains($html, '/assets/js/toast.js')) $html = str_replace('</body>', '<script src="/assets/js/toast.js"></script></body>', $html);
        if (isset($_SESSION['user']) && !str_contains($html, 'class="page-nav"') && !str_contains($html, 'class="app-shell"')) {
            $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
            $active = static fn (string $prefix): string => str_starts_with($path, $prefix) ? ' class="active"' : '';
            $navigation = '<nav class="page-nav"><a class="brand" href="/dashboard"><span class="brand-mark" aria-hidden="true">A</span><span><strong>AGEN</strong><small>Jurnal kelas</small></span></a><p class="nav-caption">MENU UTAMA</p><div>'
                .'<a'.$active('/dashboard').' href="/dashboard">Ikhtisar</a>'
                .'<a'.$active('/attendance').' href="/attendance/create">Absensi</a>'
                .'<a'.$active('/journals').' href="/journals">Jurnal</a>'
                .'<a'.$active('/reports').' href="/reports/monthly">Laporan</a>'
                .'</div></nav>';
            $html = str_replace('<body>', '<body>'.$navigation, $html);
        }
        return new self($html, $status, ['Content-Type' => 'text/html; charset=utf-8']);
    }
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

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
        if (isset($_SESSION['user']) && !str_contains($html, 'class="app-shell"')) {
            $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
            $active = static fn (string $prefix): string => str_starts_with($path, $prefix) ? ' class="active"' : '';
            $user = $_SESSION['user'];
            $name = e((string)($user['name'] ?? 'Pengguna'));
            $username = e((string)($user['username'] ?? ''));
            $initials = e(mb_strtoupper(mb_substr((string)($user['name'] ?? 'A'), 0, 2)));
            $csrf = e((string)($_SESSION['csrf_token'] ?? ''));
            $icons = [
                'dashboard' => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v10h-6zM4 14h6v6H4zM14 18h6v2h-6z"/></svg>',
                'attendance' => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v3m8-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Zm3 8h3v3H8z"/></svg>',
                'journals' => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V3Zm3 4h8M8 11h8M8 15h5"/></svg>',
                'reports' => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10m7 10V4m7 16v-7M3 20h18"/></svg>',
                'audit' => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v5c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-3Zm0 5v5m0 3h.01"/></svg>',
                'brand' => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 5 13h6l-1 9 9-12h-6.5l1-8Z"/></svg>',
            ];
            $audit = in_array($user['role'] ?? null, ['ADMIN', 'AUDITOR'], true)
                ? '<a'.$active('/audit-logs').' href="/audit-logs">'.$icons['audit'].'<span>Audit</span></a>' : '';
            $navigation = '<nav class="page-nav" id="page-nav" aria-label="Navigasi utama"><div class="page-nav-head"><a class="brand" href="/dashboard"><span class="brand-mark">'.$icons['brand'].'</span><span><strong>AGEN</strong><small>Jurnal kelas</small></span></a><button class="page-nav-close" type="button" aria-label="Tutup menu">×</button></div><p class="nav-caption">MENU UTAMA</p><div class="page-nav-links">'
                .'<a'.$active('/dashboard').' href="/dashboard">'.$icons['dashboard'].'<span>Ikhtisar</span></a>'
                .'<a'.$active('/attendance').' href="/attendance/create">'.$icons['attendance'].'<span>Absensi</span></a>'
                .'<a'.$active('/journals').' href="/journals">'.$icons['journals'].'<span>Jurnal</span></a>'
                .'<a'.$active('/reports').' href="/reports/monthly">'.$icons['reports'].'<span>Laporan</span></a>'
                .$audit.'</div><div class="page-nav-user"><span class="avatar">'.$initials.'</span><div><strong>'.$name.'</strong><small>@'.$username.'</small></div><form method="post" action="/logout"><input type="hidden" name="_token" value="'.$csrf.'"><button type="submit" aria-label="Keluar">↗</button></form></div></nav><button class="page-nav-scrim" type="button" aria-label="Tutup menu"></button><header class="page-topbar"><button class="page-nav-toggle" type="button" aria-controls="page-nav" aria-expanded="false"><span></span><span></span><span></span><b>Menu</b></button><a href="/dashboard"><span class="brand-mark">'.$icons['brand'].'</span><strong>AGEN</strong></a><span class="top-avatar">'.$initials.'</span></header>';
            $html = preg_replace('/<nav class="page-nav"[^>]*>.*?<\/nav>/s', '', $html) ?? $html;
            $html = preg_replace('/<body([^>]*)>/', '<body$1 class="agen-workspace">'.$navigation, $html, 1) ?? $html;
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

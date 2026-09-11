<?php

namespace Tests\Feature;

use App\Http\Response;
use PHPUnit\Framework\TestCase;

final class AuthenticatedLayoutTest extends TestCase
{
    protected function tearDown(): void
    {
        unset($_SESSION['user'], $_SESSION['csrf_token']);
        unset($_SERVER['REQUEST_URI']);
        parent::tearDown();
    }

    public function test_authenticated_pages_receive_one_consistent_responsive_navigation(): void
    {
        $_SESSION['user'] = ['name' => 'Guru Uji', 'username' => 'guru.uji', 'role' => 'TEACHER'];
        $_SESSION['csrf_token'] = 'csrf-test';
        $_SERVER['REQUEST_URI'] = '/journals/create';

        $html = Response::html('<html><head></head><body><nav class="page-nav"><a href="/old">Lama</a></nav><main>Konten</main></body></html>')->content();

        self::assertSame(1, substr_count($html, 'class="page-nav"'));
        self::assertStringContainsString('class="active" href="/journals"', $html);
        self::assertStringContainsString('class="page-topbar"', $html);
        self::assertStringContainsString('class="page-nav-toggle"', $html);
        self::assertSame(6, substr_count($html, '<svg viewBox="0 0 24 24"'));
        self::assertStringContainsString('Guru Uji', $html);
        self::assertStringNotContainsString('href="/old"', $html);
        self::assertStringContainsString('/assets/js/session-guard.js', $html);
    }

    public function test_audit_navigation_is_limited_to_authorized_roles(): void
    {
        $_SERVER['REQUEST_URI'] = '/audit-logs';
        $_SESSION['csrf_token'] = 'csrf-test';
        $_SESSION['user'] = ['name' => 'Guru', 'username' => 'guru', 'role' => 'TEACHER'];
        self::assertStringNotContainsString('href="/audit-logs"', Response::html('<html><head></head><body></body></html>')->content());

        $_SESSION['user']['role'] = 'AUDITOR';
        self::assertStringContainsString('href="/audit-logs"', Response::html('<html><head></head><body></body></html>')->content());
    }

    public function test_html_and_redirect_responses_are_not_browser_cached(): void
    {
        self::assertSame('private, no-store', Response::html('<html><head></head><body></body></html>')->headers()['Cache-Control']);
        self::assertSame('private, no-store', Response::redirect('/login')->headers()['Cache-Control']);
        self::assertSame('private, no-store', Response::json(['ok'=>true])->headers()['Cache-Control']);
    }

    public function test_session_guard_synchronizes_logout_and_rechecks_restored_pages():void
    {
        $script=(string)file_get_contents(dirname(__DIR__,2).'/public/assets/js/session-guard.js');
        $routes=(string)file_get_contents(dirname(__DIR__,2).'/routes/api.php');
        self::assertStringContainsString("new BroadcastChannel('agen-auth')",$script);
        self::assertStringContainsString("addEventListener('storage'",$script);
        self::assertStringContainsString("addEventListener('pageshow'",$script);
        self::assertStringContainsString("visibilityState==='visible'",$script);
        self::assertStringContainsString("location.replace(LOGIN_URL)",$script);
        self::assertStringContainsString("/api/auth/status",$routes);
    }
}

<?php

namespace Tests\Unit;

use App\Http\Controllers\TeacherSelfController;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

class TeacherApplicationUrlTest extends TestCase
{
    public function test_launch_url_uses_only_the_registered_http_origin(): void
    {
        $controller = (new ReflectionClass(TeacherSelfController::class))->newInstanceWithoutConstructor();
        $method = (new ReflectionClass(TeacherSelfController::class))->getMethod('applicationOrigin');

        $this->assertSame('https://agen.rdmman1plg.sch.id', $method->invoke($controller, ['javascript:alert(1)', 'https://agen.rdmman1plg.sch.id/auth/sso/callback']));
        $this->assertSame('http://localhost:8080', $method->invoke($controller, ['http://localhost:8080/callback']));
        $this->assertNull($method->invoke($controller, ['javascript:alert(1)']));
    }

    public function test_known_apps_use_their_existing_sso_start_endpoint(): void
    {
        $controller = (new ReflectionClass(TeacherSelfController::class))->newInstanceWithoutConstructor();
        $method = (new ReflectionClass(TeacherSelfController::class))->getMethod('applicationLaunchUrl');

        $this->assertSame('https://cbt.example.sch.id/auth/sso/start', $method->invoke($controller, null, ['https://cbt.example.sch.id/auth/sso/callback'], 'cbt-man-1'));
        $this->assertSame('https://agen.rdmman1plg.id/auth/sso/redirect', $method->invoke($controller, null, ['https://agen.rdmman1plg.id/auth/sso/callback'], 'junkes'));
        $this->assertSame('https://agen.rdmman1plg.id/auth/sso/redirect', $method->invoke($controller, 'https://agen.rdmman1plg.id/', ['https://agen.rdmman1plg.id/auth/sso/callback'], 'junkes'));
        $this->assertSame('https://app.example.sch.id/login/sso', $method->invoke($controller, 'https://app.example.sch.id/login/sso', ['https://app.example.sch.id/callback']));
        $this->assertSame('https://unknown.example.sch.id', $method->invoke($controller, null, ['https://unknown.example.sch.id/auth/sso/callback'], 'unknown'));
    }
}

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
}

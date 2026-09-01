<?php
namespace Tests\Feature;
use App\Http\Middleware\AuditAccessMiddleware;
use App\Http\Middleware\TeacherOnlyMiddleware;
use App\Http\Request;
use App\Http\Response;
use PHPUnit\Framework\TestCase;
final class AuthorizationRoleTest extends TestCase
{
    public function test_teacher_cannot_access_audit_api():void{$_SESSION['user']=['role'=>'TEACHER'];$response=(new AuditAccessMiddleware())->handle(new Request('GET','/api/audit-logs',[],[],[],[]),fn()=>Response::json(['ok'=>true]));self::assertSame(403,$response->statusCode());}
    public function test_auditor_can_access_read_only_audit_api():void{$_SESSION['user']=['role'=>'AUDITOR'];$response=(new AuditAccessMiddleware())->handle(new Request('GET','/api/audit-logs',[],[],[],[]),fn()=>Response::json(['ok'=>true]));self::assertSame(200,$response->statusCode());}
    public function test_auditor_cannot_mutate_attendance():void{$_SESSION['user']=['role'=>'AUDITOR'];$response=(new TeacherOnlyMiddleware())->handle(new Request('POST','/api/attendance',[],[],[],[]),fn()=>Response::json(['ok'=>true]));self::assertSame(403,$response->statusCode());}
}

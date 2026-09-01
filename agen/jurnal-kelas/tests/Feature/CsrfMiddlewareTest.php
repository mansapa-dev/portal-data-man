<?php
namespace Tests\Feature;
use App\Http\Middleware\CsrfMiddleware;
use App\Http\Request;
use App\Http\Response;
use PHPUnit\Framework\TestCase;
final class CsrfMiddlewareTest extends TestCase
{
    protected function setUp():void{$_SESSION=['csrf_token'=>'known-token'];}
    public function test_rejects_mutation_without_valid_token():void{$request=new Request('POST','/api/test',[],[],[],[]);$response=(new CsrfMiddleware())->handle($request,fn()=>Response::json(['ok'=>true]));self::assertSame(419,$response->statusCode());}
    public function test_accepts_matching_header_token():void{$request=new Request('POST','/api/test',[],[],[],['HTTP_X_CSRF_TOKEN'=>'known-token']);$response=(new CsrfMiddleware())->handle($request,fn()=>Response::json(['ok'=>true]));self::assertSame(200,$response->statusCode());}
}

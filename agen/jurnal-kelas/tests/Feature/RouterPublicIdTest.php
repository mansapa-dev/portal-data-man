<?php
namespace Tests\Feature;
use App\Http\Request;
use App\Http\Response;
use App\Http\Router\Router;
use App\Support\Container;
use PHPUnit\Framework\TestCase;
final class RouterPublicIdTest extends TestCase
{
    public function test_numeric_internal_id_does_not_match_public_route():void{$router=new Router(new Container());$router->get('/journals/{publicId}',fn()=>Response::json(['ok'=>true]));$response=$router->dispatch(new Request('GET','/journals/12',[],[],[],[]));self::assertSame(404,$response->statusCode());}
    public function test_valid_ulid_matches_public_route():void{$router=new Router(new Container());$router->get('/journals/{publicId}',fn()=>Response::json(['ok'=>true]));$response=$router->dispatch(new Request('GET','/journals/01J6A1BCDEFGHJKMNPQRSTVWXY',[],[],[],[]));self::assertSame(200,$response->statusCode());}
}

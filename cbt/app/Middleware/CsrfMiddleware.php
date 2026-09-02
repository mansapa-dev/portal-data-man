<?php
declare(strict_types=1);
namespace Cbt\Middleware;
use Cbt\Core\{Request,Response,Session};
final class CsrfMiddleware { public function __invoke(Request$r,callable$next):Response{$token=(string)($r->server['HTTP_X_CSRF_TOKEN']??'');if($token===''||!hash_equals(Session::csrf(),$token))return Response::error('Token CSRF tidak valid.',419);return$next($r);} }

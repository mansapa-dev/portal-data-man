<?php
declare(strict_types=1);
namespace Cbt\Middleware;
use Cbt\Core\{Request,Response};
final class AuthMiddleware { public function __construct(private string$type,private ?string$role=null){} public function __invoke(Request$r,callable$next):Response{$auth=$_SESSION[$this->type]??null;if(!$auth)return Response::error('Silakan login terlebih dahulu.',401);if($this->role!==null&&($auth['role']??null)!==$this->role)return Response::error('Akses ditolak.',403);return$next($r);} }

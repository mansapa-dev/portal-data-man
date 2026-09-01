<?php
namespace App\Http\Controllers;
use App\Application\Audit\AuditLogService;
use App\Http\Request;
use App\Http\Response;
use RuntimeException;
final class AuditController
{
    public function __construct(private readonly AuditLogService $audit){}
    public function index(Request $r):Response{return Response::json(['success'=>true,'data'=>$this->audit->list($r->query)]);}
    public function show(Request $r):Response{try{return Response::json(['success'=>true,'data'=>$this->audit->detail((string)$r->attribute('publicId'))]);}catch(RuntimeException $e){return Response::json(['success'=>false,'message'=>$e->getMessage()],404);}}
    public function page(Request $r):Response{$csrf=e($_SESSION['csrf_token']);ob_start();require dirname(__DIR__,3).'/resources/views/audit/index.php';return Response::html((string)ob_get_clean());}
}

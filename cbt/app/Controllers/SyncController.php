<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Request,Response};
use Cbt\Services\PortalDataSyncService;
final class SyncController
{
 public function __construct(private PortalDataSyncService$sync){}
 public function run(Request$r):Response{return Response::json($this->sync->sync(strtoupper((string)$r->attributes['type']),(int)$_SESSION['auth']['user_id']),'Sinkronisasi selesai.');}
}

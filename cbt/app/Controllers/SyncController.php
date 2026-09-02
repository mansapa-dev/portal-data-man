<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Request,Response};
use Cbt\Exceptions\DomainException;
use Cbt\Integrations\PortalData\PortalDataException;
use Cbt\Services\PortalDataSyncService;
final class SyncController
{
 public function __construct(private PortalDataSyncService$sync){}
 public function run(Request$r):Response{try{return Response::json($this->sync->sync(strtoupper((string)$r->attributes['type']),(int)$_SESSION['auth']['user_id']),'Sinkronisasi selesai.');}catch(PortalDataException$e){throw new DomainException($e->getMessage(),502);}}
 public function status(Request$r):Response{return Response::json($this->sync->status((int)$r->input('limit',20)));}
}

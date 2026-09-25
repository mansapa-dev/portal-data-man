<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Request,Response};
use Cbt\Services\StaffAdminCommunicationService;
final class StaffAdminCommunicationController
{
 public function __construct(private StaffAdminCommunicationService$service){}
 public function index(Request$r):Response{return Response::json($this->service->threads($_SESSION['auth']));}
 public function create(Request$r):Response{return Response::json($this->service->create($_SESSION['auth'],$r->json()),'Pesan dikirim kepada admin.',201);}
 public function messages(Request$r):Response{return Response::json($this->service->messages($_SESSION['auth'],(string)$r->attributes['id']));}
 public function reply(Request$r):Response{$this->service->reply($_SESSION['auth'],(string)$r->attributes['id'],$r->json());return Response::json(null,'Balasan terkirim.');}
 public function status(Request$r):Response{$this->service->status($_SESSION['auth'],(string)$r->attributes['id'],(string)$r->input('status'));return Response::json(null,'Status diperbarui.');}
}

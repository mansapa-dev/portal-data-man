<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Request,Response};
use Cbt\Services\SupportTicketService;
final class SupportTicketController
{
 public function __construct(private SupportTicketService $tickets){}
 public function create(Request$r):Response{$student=isset($_SESSION['student']['student_id'])?(int)$_SESSION['student']['student_id']:null;$ticket=$this->tickets->create($student,$r->json());return Response::json($ticket,'Permintaan bantuan sudah diterima petugas.');}
 public function studentIndex(Request$r):Response{return Response::json($this->tickets->studentTickets((int)$_SESSION['student']['student_id']));}
 public function staffIndex(Request$r):Response{return Response::json($this->tickets->staffTickets($_SESSION['auth'],(string)$r->input('status','ALL')));}
 public function update(Request$r):Response{$ticket=$this->tickets->update((string)$r->attributes['id'],$_SESSION['auth'],(string)$r->input('status',''),(string)$r->input('note',''));return Response::json($ticket,'Status tiket berhasil diperbarui.');}
 public function reset(Request$r):Response{$result=$this->tickets->resetAndResolve((string)$r->attributes['id'],$_SESSION['auth'],(string)$r->input('reason',''));return Response::json($result,'CBT dibuka dan tiket diselesaikan. Siswa dapat melanjutkan ujian.');}
}

<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Request,Response};
use Cbt\Services\AdminService;
final class AdminController
{
 public function __construct(private AdminService$admin){}
 public function dashboard(Request$r):Response{return Response::json($this->admin->dashboard());}
 public function references(Request$r):Response{return Response::json($this->admin->references());}
 public function exams(Request$r):Response{return Response::json($this->admin->exams());}
 public function saveExam(Request$r):Response{$this->admin->saveExam($r->json(),(int)$_SESSION['auth']['user_id']);return Response::json(null,'Ujian berhasil disimpan.');}
 public function questions(Request$r):Response{return Response::json($this->admin->questions($r->input('exam_id')!==null?(int)$r->input('exam_id'):null));}
 public function saveQuestion(Request$r):Response{$this->admin->saveQuestion($r->json());return Response::json(null,'Soal berhasil disimpan.');}
 public function users(Request$r):Response{return Response::json($this->admin->users());}
 public function saveUser(Request$r):Response{$this->admin->saveUser($r->json());return Response::json(null,'Akun berhasil disimpan.');}
 public function assignments(Request$r):Response{return Response::json($this->admin->assignments());}
 public function saveAssignment(Request$r):Response{$this->admin->saveAssignment($r->json(),(int)$_SESSION['auth']['user_id']);return Response::json(null,'Penugasan berhasil disimpan.');}
 public function deleteAssignment(Request$r):Response{$this->admin->deleteAssignment((int)$r->attributes['id']);return Response::json(null,'Penugasan berhasil dihapus.');}
 public function results(Request$r):Response{return Response::json($this->admin->results());}
 public function violations(Request$r):Response{return Response::json($this->admin->violations());}
 public function importQuestions(Request$r):Response{$summary=$this->admin->importQuestions((array)$r->input('rows',[]));return Response::json($summary,"Import selesai: {$summary['inserted']} berhasil, {$summary['failed']} gagal.");}
 public function importUsers(Request$r):Response{$summary=$this->admin->importUsers((array)$r->input('rows',[]));return Response::json($summary,"Import selesai: {$summary['inserted']} berhasil, {$summary['failed']} gagal.");}
}

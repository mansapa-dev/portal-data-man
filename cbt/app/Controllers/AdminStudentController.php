<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Request,Response};
use Cbt\Services\AdminStudentService;
final class AdminStudentController
{
 public function __construct(private AdminStudentService$students){}
 public function index(Request$r):Response{return Response::json($this->students->all());}
 public function setPin(Request$r):Response{ $pin=$this->students->setPin($r->json());return Response::json(["pin"=>$pin],'PIN CBT siswa berhasil disimpan.');}
 public function generateBatch(Request$r):Response{$b=$r->json();$res=$this->students->generatePinsBatch($b['tingkat']??null,$b['kelas']??null);return Response::json($res,"PIN otomatis berhasil dibuat untuk {$res['updated']} siswa.");}
 public function reset(Request$r):Response{$this->students->reset((int)$r->attributes['id']);return Response::json(null,'Attempt siswa berhasil dibuka/reset.');}
}

<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Request,Response};
use Cbt\Services\AdminStudentService;
final class AdminStudentController
{
 public function __construct(private AdminStudentService$students, private \Cbt\Services\AttemptResetService $resets){}
 public function index(Request$r):Response{return Response::json($this->students->all());}
 public function setPin(Request$r):Response{ $pin=$this->students->setPin($r->json());return Response::json(["pin"=>$pin],'PIN CBT siswa berhasil disimpan.');}
 public function generateBatch(Request$r):Response{$b=$r->json();$res=$this->students->generatePinsBatch($b['tingkat']??null,$b['kelas']??null,(int)($b['cursor']??0),(int)($b['limit']??50));return Response::json($res,$res['done']?'Generate PIN selesai.':'Batch PIN berhasil diproses.');}
 public function reset(Request$r):Response{$result=$this->resets->reset((int)$r->attributes['id'],(int)$r->input('exam_id',0),(int)$_SESSION['auth']['user_id'],(string)$r->input('reason',''));return Response::json($result,'CBT dibuka. Siswa dapat melanjutkan dengan jawaban sebelumnya.');}
}

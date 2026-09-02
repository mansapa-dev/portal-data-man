<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Request,Response};
use Cbt\Services\{AnswerService,ExamSessionService,ScoringService,ViolationService};
final class StudentExamController
{
 public function __construct(private ExamSessionService$exams,private AnswerService$answers,private ViolationService$violations,private ScoringService$scoring){}
 private function session():array{return $_SESSION['student'];}
 public function index(Request$r):Response{$s=$this->session();return Response::json($this->exams->list($s['student_id'],$s['nisn']));}
 public function start(Request$r):Response{$s=$this->session();return Response::json($this->exams->start($s['student_id'],$s['nisn'],(int)$r->attributes['id']),'Ujian siap.');}
 public function answer(Request$r):Response{$s=$this->session();return Response::json($this->answers->save($s['student_id'],(int)$r->attributes['id'],(int)$r->attributes['questionId'],$r->input('answer'),filter_var($r->input('is_flagged',false),FILTER_VALIDATE_BOOL)),'Jawaban tersimpan.');}
 public function violation(Request$r):Response{$s=$this->session();return Response::json($this->violations->record($s['student_id'],(int)$r->attributes['id'],(string)$r->input('event_key'),strtoupper((string)$r->input('type','TAB_HIDDEN')),$r->input('client_occurred_at'),$r->ip(),(string)($r->server['HTTP_USER_AGENT']??'')),'Pelanggaran tercatat.');}
 public function submit(Request$r):Response{$s=$this->session();return Response::json($this->scoring->submit($s['student_id'],(int)$r->attributes['id']),'Ujian berhasil diselesaikan.');}
 public function review(Request$r):Response{$s=$this->session();return Response::json($this->scoring->review($s['student_id'],(int)$r->attributes['id']));}
}

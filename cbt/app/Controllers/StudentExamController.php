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
 public function heartbeat(Request$r):Response{$s=$this->session();return Response::json($this->exams->heartbeat($s['student_id'],(int)$r->attributes['id']));}
 public function start(Request$r):Response{$s=$this->session();$id=(int)$r->attributes['id'];$completed=$this->scoring->recover($s['student_id'],$id);return Response::json($completed??$this->exams->start($s['student_id'],$s['nisn'],$id),'Ujian siap.');}
 public function answer(Request$r):Response{$s=$this->session();return Response::json($this->answers->save($s['student_id'],(int)$r->attributes['id'],(int)$r->attributes['questionId'],$r->input('answer'),filter_var($r->input('is_flagged',false),FILTER_VALIDATE_BOOL),(string)$r->input('attempt_id',''),(int)$r->input('base_revision',-1),(string)$r->input('mutation_id','')),'Jawaban tersimpan.');}
 public function violation(Request$r):Response{$s=$this->session();$result=$this->violations->record($s['student_id'],(int)$r->attributes['id'],(string)$r->input('event_key'),strtoupper((string)$r->input('type','TAB_HIDDEN')),$r->input('client_occurred_at'),$r->ip(),(string)($r->server['HTTP_USER_AGENT']??''));if($result['terminated'])$result['hasil']=$this->scoring->submit($s['student_id'],(int)$r->attributes['id'],true);return Response::json($result,'Pelanggaran tercatat.');}
 public function submit(Request$r):Response{$s=$this->session();return Response::json($this->scoring->submit($s['student_id'],(int)$r->attributes['id'],filter_var($r->input('finalize_only',false),FILTER_VALIDATE_BOOL)),'Ujian berhasil diselesaikan.');}
 public function review(Request$r):Response{$s=$this->session();return Response::json($this->scoring->review($s['student_id'],(int)$r->attributes['id']));}
}

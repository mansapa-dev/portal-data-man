<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Request,Response};
use Cbt\Services\AdminStudentService;
final class AdminStudentController
{
 public function __construct(private AdminStudentService$students, private \Cbt\Services\AttemptResetService $resets){}
 public function index(Request$r):Response{return Response::json($r->input('page')!==null?$this->students->page($r->query):$this->students->all());}
 public function setPin(Request$r):Response{ $pin=$this->students->setPin($r->json());return Response::json(["pin"=>$pin],'PIN CBT siswa berhasil disimpan.');}
 public function generateBatch(Request$r):Response{$b=$r->json();$res=$this->students->generatePinsBatch($b['tingkat']??null,$b['kelas']??null,(int)($b['cursor']??0),(int)($b['limit']??50));return Response::json($res,$res['done']?'Generate PIN selesai.':'Batch PIN berhasil diproses.');}
 public function reset(Request$r):Response{$result=$this->resets->reset((int)$r->attributes['id'],(int)$r->input('exam_id',0),(int)$_SESSION['auth']['user_id'],(string)$r->input('reason',''));return Response::json($result,'CBT dibuka. Siswa dapat melanjutkan dengan jawaban sebelumnya.');}
 public function resetBatch(Request $request): Response
 {
  $body = $request->json();
  $items = $body['attempts'] ?? [];
  $reason = trim((string)($body['reason'] ?? ''));
  if (!is_array($items) || !$items || count($items) > 25) {
   throw new \Cbt\Exceptions\DomainException('Pilih 1 sampai 25 siswa per proses reset.', 422);
  }
  if ($reason === '' || mb_strlen($reason) > 1000) {
   throw new \Cbt\Exceptions\DomainException('Alasan reset wajib diisi dan maksimal 1000 karakter.', 422);
  }

  $results = [];
  $actor = (int)$_SESSION['auth']['user_id'];
  foreach ($items as $item) {
   if (!is_array($item)) {
    $results[] = ['student_id' => 0, 'exam_id' => 0, 'success' => false, 'message' => 'Data siswa tidak valid.'];
    continue;
   }
   $studentId = (int)($item['student_id'] ?? 0);
   $examId = (int)($item['exam_id'] ?? 0);
   try {
    $result = $this->resets->reset($studentId, $examId, $actor, $reason);
    $results[] = ['student_id' => $studentId, 'exam_id' => $examId, 'success' => true, 'attempt_id' => $result['attempt_id']];
   } catch (\Cbt\Exceptions\DomainException $error) {
    $results[] = ['student_id' => $studentId, 'exam_id' => $examId, 'success' => false, 'message' => $error->getMessage()];
   } catch (\Throwable $error) {
    error_log('Reset CBT massal gagal untuk attempt '.$studentId.'/'.$examId.': '.$error->getMessage());
    $results[] = ['student_id' => $studentId, 'exam_id' => $examId, 'success' => false, 'message' => 'Kesalahan server saat mereset CBT.'];
   }
  }
  return Response::json(['results' => $results], 'Reset CBT massal selesai.');
 }
}

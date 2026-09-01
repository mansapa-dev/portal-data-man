<?php
namespace App\Http\Controllers;

use App\Application\Attendance\AttendanceService;
use App\Http\Request;
use App\Http\Response;
use InvalidArgumentException;
use RuntimeException;

final class AttendanceController
{
    public function __construct(private readonly AttendanceService $attendance) {}
    public function subjects(Request $request):Response{return Response::json(['success'=>true,'data'=>$this->attendance->subjects()]);}
    public function create(Request $request):Response{return $this->execute(fn()=>Response::json(['success'=>true,'message'=>'Draft absensi berhasil dibuat.','data'=>$this->attendance->create($request->body,$this->actor(),$this->token())],201));}
    public function show(Request $request):Response{return $this->execute(fn()=>Response::json(['success'=>true,'data'=>$this->attendance->detail((string)$request->attribute('publicId'),$this->actor())]));}
    public function mark(Request $request):Response{return $this->execute(fn()=>Response::json(['success'=>true,'message'=>'Status kehadiran diperbarui.','data'=>$this->attendance->mark((string)$request->attribute('publicId'),(string)$request->attribute('studentPublicId'),(string)$request->input('status'),$this->nullable($request->input('note')),$this->nullable($request->input('correctionReason')),$this->actor())]));}
    public function markAll(Request $request):Response{return $this->execute(fn()=>Response::json(['success'=>true,'message'=>'Siswa yang belum ditandai diubah menjadi hadir.','data'=>$this->attendance->markAllPresent((string)$request->attribute('publicId'),$this->actor())]));}
    public function scan(Request $request):Response{return $this->execute(fn()=>Response::json(['success'=>true,'message'=>'Siswa berhasil ditandai hadir.','data'=>$this->attendance->scan((string)$request->attribute('publicId'),trim((string)$request->input('nisn')),$this->actor())]));}
    public function finalize(Request $request):Response{return $this->execute(fn()=>Response::json(['success'=>true,'message'=>'Absensi berhasil difinalisasi.','data'=>$this->attendance->finalize((string)$request->attribute('publicId'),$this->actor())]));}
    private function actor():array{return $_SESSION['user'];}
    private function token():string{if(!isset($_SESSION['portal_access_token'])||(int)($_SESSION['portal_access_expires_at']??0)<=time()+5)throw new InvalidArgumentException('Token Portal Data berakhir. Silakan login kembali.');return (string)$_SESSION['portal_access_token'];}
    private function nullable(mixed $value):?string{$value=trim((string)$value);return $value===''?null:substr($value,0,500);}
    private function execute(callable $callback):Response{try{return $callback();}catch(InvalidArgumentException $error){return Response::json(['success'=>false,'message'=>$error->getMessage()],422);}catch(RuntimeException $error){return Response::json(['success'=>false,'message'=>$error->getMessage()],404);}}
}

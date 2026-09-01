<?php
namespace App\Http\Controllers;
use App\Application\Journal\JournalService;
use App\Http\Request;
use App\Http\Response;
use InvalidArgumentException;
use RuntimeException;
final class JournalController
{
    public function __construct(private readonly JournalService $journals){}
    public function index(Request $r):Response{return $this->run(fn()=>Response::json(['success'=>true,'data'=>$this->journals->list($this->actor(),$r->query)]));}
    public function attendance(Request $r):Response{return $this->run(fn()=>Response::json(['success'=>true,'data'=>$this->journals->availableAttendance($this->actor())]));}
    public function create(Request $r):Response{return $this->run(fn()=>Response::json(['success'=>true,'message'=>'Draft jurnal berhasil dibuat.','data'=>$this->journals->create($r->body,$this->actor())],201));}
    public function show(Request $r):Response{return $this->run(fn()=>Response::json(['success'=>true,'data'=>$this->journals->detail((string)$r->attribute('publicId'),$this->actor())]));}
    public function update(Request $r):Response{return $this->run(fn()=>Response::json(['success'=>true,'message'=>'Jurnal berhasil diperbarui.','data'=>$this->journals->update((string)$r->attribute('publicId'),$r->body,$this->actor())]));}
    public function upload(Request $r):Response{return $this->run(fn()=>Response::json(['success'=>true,'message'=>'Dokumentasi berhasil diunggah.','data'=>$this->journals->upload((string)$r->attribute('publicId'),$r->files['file']??[],$this->actor())],201));}
    public function finalize(Request $r):Response{return $this->run(fn()=>Response::json(['success'=>true,'message'=>'Jurnal berhasil difinalisasi.','data'=>$this->journals->finalize((string)$r->attribute('publicId'),$this->actor())]));}
    public function revise(Request $r):Response{return $this->run(fn()=>Response::json(['success'=>true,'message'=>'Revisi jurnal berhasil disimpan.','data'=>$this->journals->revise((string)$r->attribute('publicId'),$r->body,$this->actor())]));}
    public function destroy(Request $r):Response{return $this->run(function()use($r){$this->journals->deleteDraft((string)$r->attribute('publicId'),$this->actor());return Response::json(['success'=>true,'message'=>'Draft jurnal berhasil dihapus.','data'=>null]);});}
    public function deleteFile(Request $r):Response{return $this->run(fn()=>Response::json(['success'=>true,'message'=>'Dokumentasi berhasil dihapus.','data'=>$this->journals->deleteDocumentation((string)$r->attribute('publicId'),(string)$r->attribute('filePublicId'),$this->actor())]));}
    public function file(Request $r):Response{return $this->run(function()use($r){$file=$this->journals->file((string)$r->attribute('publicId'),(string)$r->attribute('filePublicId'),$this->actor());return Response::download($file['content'],$file['mime'],$file['name']);});}
    private function actor():array{return $_SESSION['user'];}
    private function run(callable $callback):Response{try{return $callback();}catch(InvalidArgumentException $e){return Response::json(['success'=>false,'message'=>$e->getMessage()],422);}catch(RuntimeException $e){return Response::json(['success'=>false,'message'=>$e->getMessage()],404);}}
}

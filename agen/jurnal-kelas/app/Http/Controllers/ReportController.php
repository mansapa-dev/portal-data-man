<?php
namespace App\Http\Controllers;
use App\Application\Report\MonthlyReportService;
use App\Http\Request;
use App\Http\Response;
use InvalidArgumentException;
final class ReportController
{
    public function __construct(private readonly MonthlyReportService $reports){}
    public function monthly(Request $r):Response{return $this->run(fn()=>Response::json(['success'=>true,'data'=>$this->reports->data($r->query,$_SESSION['user'])]));}
    public function excel(Request $r):Response{return $this->run(function()use($r){$report=$this->reports->data($r->query,$_SESSION['user']);return Response::attachment($this->reports->excel($report),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',sprintf('laporan-jurnal-%04d-%02d.xlsx',$report['period']['year'],$report['period']['month']));});}
    public function pdf(Request $r):Response{return $this->run(function()use($r){$report=$this->reports->data($r->query,$_SESSION['user']);return Response::attachment($this->reports->pdf($report,$_SESSION['user']),'application/pdf',sprintf('laporan-jurnal-%04d-%02d.pdf',$report['period']['year'],$report['period']['month']));});}
    private function run(callable $callback):Response{try{return $callback();}catch(InvalidArgumentException $e){return Response::json(['success'=>false,'message'=>$e->getMessage()],422);}}
}

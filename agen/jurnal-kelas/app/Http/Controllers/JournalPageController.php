<?php
namespace App\Http\Controllers;
use App\Http\Request;
use App\Http\Response;
final class JournalPageController
{
    private function view(string $view,?string $publicId=null):Response{$csrf=e($_SESSION['csrf_token']);$publicId=$publicId?e($publicId):null;ob_start();require dirname(__DIR__,3).'/resources/views/journals/'.$view.'.php';return Response::html((string)ob_get_clean());}
    public function index(Request $r):Response{return $this->view('index');}
    public function create(Request $r):Response{return $this->view('create');}
    public function show(Request $r):Response{return $this->view('show',(string)$r->attribute('publicId'));}
    public function edit(Request $r):Response{return $this->view('edit',(string)$r->attribute('publicId'));}
}

<?php
namespace App\Http\Controllers;
use App\Http\Request;
use App\Http\Response;
final class AttendancePageController
{
    public function create(Request $request):Response{$csrf=e($_SESSION['csrf_token']);ob_start();require dirname(__DIR__,3).'/resources/views/attendance/create.php';return Response::html((string)ob_get_clean());}
    public function show(Request $request):Response{$csrf=e($_SESSION['csrf_token']);$publicId=e($request->attribute('publicId'));ob_start();require dirname(__DIR__,3).'/resources/views/attendance/show.php';return Response::html((string)ob_get_clean());}
}

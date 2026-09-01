<?php
namespace App\Http\Controllers;
use App\Http\Request;
use App\Http\Response;
final class ReportPageController
{
    public function monthly(Request $r):Response{$csrf=e($_SESSION['csrf_token']);ob_start();require dirname(__DIR__,3).'/resources/views/reports/monthly.php';return Response::html((string)ob_get_clean());}
}

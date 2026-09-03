<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Request,Response};
use Cbt\Services\AdminService;
final class TeacherController
{
 public function __construct(private AdminService$service){}
 public function dashboard(Request$r):Response{$a=$_SESSION['auth'];return Response::json($this->service->teacherDashboard((int)$a['user_id'],(string)$a['role']));}
}

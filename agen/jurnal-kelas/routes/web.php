<?php
use App\Http\Controllers\HomeController;
use App\Http\Controllers\AuthController;
use App\Http\Middleware\AuthenticateMiddleware;
use App\Http\Controllers\AttendancePageController;
use App\Http\Controllers\JournalPageController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\ReportPageController;
use App\Http\Controllers\AuditController;
use App\Http\Middleware\AuditAccessMiddleware;

$router->get('/', [HomeController::class, 'landing']);
$router->get('/login', [AuthController::class, 'login']);
$router->get('/auth/sso/redirect', [AuthController::class, 'redirect']);
$router->get('/auth/sso/callback', [AuthController::class, 'callback']);
$router->post('/logout', [AuthController::class, 'logout']);
$router->get('/dashboard', [HomeController::class, 'index'], [AuthenticateMiddleware::class]);
$router->get('/attendance/create', [AttendancePageController::class, 'create'], [AuthenticateMiddleware::class]);
$router->get('/attendance/{publicId}', [AttendancePageController::class, 'show'], [AuthenticateMiddleware::class]);
$router->get('/journals', [JournalPageController::class, 'index'], [AuthenticateMiddleware::class]);
$router->get('/journals/create', [JournalPageController::class, 'create'], [AuthenticateMiddleware::class]);
$router->get('/journals/{publicId}/edit', [JournalPageController::class, 'edit'], [AuthenticateMiddleware::class]);
$router->get('/journals/{publicId}', [JournalPageController::class, 'show'], [AuthenticateMiddleware::class]);
$router->get('/reports/monthly', [ReportPageController::class, 'monthly'], [AuthenticateMiddleware::class]);
$router->get('/reports/monthly/excel', [ReportController::class, 'excel'], [AuthenticateMiddleware::class]);
$router->get('/reports/monthly/pdf', [ReportController::class, 'pdf'], [AuthenticateMiddleware::class]);
$router->get('/audit-logs', [AuditController::class, 'page'], [AuthenticateMiddleware::class, AuditAccessMiddleware::class]);
$router->get('/health', [HomeController::class, 'health']);

<?php
namespace App\Http\Controllers;

use App\Http\Request;
use App\Http\Response;
use App\Support\Config;
use App\Application\Dashboard\DashboardService;

final class HomeController
{
    public function __construct(private readonly Config $config,private readonly DashboardService $dashboard) {}
    public function index(Request $request): Response
    {
        if (!isset($_SESSION['user'])) return Response::redirect('/login');
        $title = e($this->config->get('app.name'));
        $csrf = e($_SESSION['csrf_token'] ?? '');
        $user = $_SESSION['user'];
        $reference = $_SESSION['portal_reference'] ?? ['classes' => [], 'periods' => [], 'synced_at' => null];
        $dashboard = $this->dashboard->forUser($user);
        ob_start();
        require dirname(__DIR__, 3).'/resources/views/dashboard/index.php';
        return Response::html((string) ob_get_clean());
    }
    public function health(Request $request): Response { return Response::json(['success' => true, 'data' => ['service' => 'jurnal-kelas', 'time' => date(DATE_ATOM)]]); }
}

<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        DB::select('SELECT 1');

        return response()->json(['message' => 'Portal Data sehat.', 'data' => ['status' => 'ok', 'database' => 'connected', 'time' => now()->toISOString()]]);
    }
}

<?php

namespace App\Support;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\JsonResponse;

class ApiResponse
{
    public static function success(mixed $data = null, string $message = 'Permintaan berhasil.', int $status = 200): JsonResponse
    {
        return response()->json(['success' => true, 'message' => $message, 'data' => $data], $status);
    }

    public static function paginated(LengthAwarePaginator $page, string $message = 'Data berhasil diambil.'): JsonResponse
    {
        return response()->json(['success' => true, 'message' => $message, 'data' => $page->items(), 'meta' => ['page' => $page->currentPage(), 'perPage' => $page->perPage(), 'total' => $page->total(), 'totalPages' => $page->lastPage()]]);
    }
}

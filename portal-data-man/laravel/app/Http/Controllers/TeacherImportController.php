<?php

namespace App\Http\Controllers;

use App\Models\ImportBatch;
use App\Services\TeacherImportService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TeacherImportController extends Controller
{
    public function __construct(private readonly TeacherImportService $imports) {}

    public function validateFile(Request $request): JsonResponse
    {
        $request->validate(['file' => ['required', 'file', 'max:'.((int) config('imports.max_file_size_mb') * 1024)]]);
        $batch = $this->imports->validate($request->file('file'), $request);

        return ApiResponse::success(['importPublicId' => $batch->publicId, 'status' => $batch->status, 'summary' => $batch->summary], 'File selesai divalidasi.', 201);
    }

    public function commit(Request $request, ImportBatch $importBatch): JsonResponse
    {
        abort_unless($importBatch->type === 'TEACHER', 404);

        return ApiResponse::success($this->imports->commit($importBatch, $request), 'Import selesai diproses.');
    }
}

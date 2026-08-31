<?php

namespace App\Http\Controllers;

use App\Models\ImportBatch;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Storage;

class ImportManagementController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:255'],
            'type' => ['nullable', Rule::in(['STUDENT', 'TEACHER'])],
            'status' => ['nullable', Rule::in(['UPLOADED', 'VALIDATING', 'READY', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'])],
            'createdBy' => ['nullable', 'string', 'size:26'],
            'dateFrom' => ['nullable', 'date_format:Y-m-d'],
            'dateTo' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:dateFrom'],
            'page' => ['nullable', 'integer', 'min:1'],
            'perPage' => ['nullable', 'integer', 'between:1,100'],
            'sortBy' => ['nullable', Rule::in(['createdAt', 'originalFilename', 'status', 'type'])],
            'sortDirection' => ['nullable', Rule::in(['asc', 'desc'])],
        ]);
        $query = ImportBatch::query()
            ->when($filters['search'] ?? null, fn ($query, $value) => $query->where('originalFilename', 'like', "%{$value}%"))
            ->when($filters['type'] ?? null, fn ($query, $value) => $query->where('type', $value))
            ->when($filters['status'] ?? null, fn ($query, $value) => $query->where('status', $value))
            ->when($filters['createdBy'] ?? null, fn ($query, $value) => $query->where('createdBy', $value))
            ->when($filters['dateFrom'] ?? null, fn ($query, $value) => $query->whereDate('createdAt', '>=', $value))
            ->when($filters['dateTo'] ?? null, fn ($query, $value) => $query->whereDate('createdAt', '<=', $value));

        $page = $query->orderBy($filters['sortBy'] ?? 'createdAt', $filters['sortDirection'] ?? 'desc')->paginate($filters['perPage'] ?? 25);
        $page->setCollection($page->getCollection()->map(fn (ImportBatch $batch) => [...$batch->toArray(), 'hasErrorFile' => filled($batch->getRawOriginal('errorFilePath'))]));

        return ApiResponse::paginated($page, 'Riwayat import berhasil diambil.');
    }

    public function show(ImportBatch $importBatch): JsonResponse
    {
        return ApiResponse::success([...$importBatch->toArray(), 'hasErrorFile' => filled($importBatch->getRawOriginal('errorFilePath'))], 'Batch import berhasil diambil.');
    }

    public function rows(Request $request, ImportBatch $importBatch): JsonResponse
    {
        $filters = $request->validate(['status' => ['nullable', Rule::in(['VALID', 'INSERTED', 'UPDATED', 'SKIPPED', 'WARNING', 'FAILED'])], 'search' => ['nullable', 'string', 'max:191'], 'page' => ['nullable', 'integer', 'min:1'], 'perPage' => ['nullable', 'integer', 'between:1,100']]);
        $query = $importBatch->rows()->when($filters['status'] ?? null, fn ($query, $value) => $query->where('status', $value))->when($filters['search'] ?? null, fn ($query, $value) => $query->where('identifier', 'like', "%{$value}%"));

        return ApiResponse::paginated($query->orderBy('rowNumber')->paginate($filters['perPage'] ?? 25), 'Detail baris import berhasil diambil.');
    }

    public function errorFile(ImportBatch $importBatch): mixed
    {
        abort_unless($importBatch->errorFilePath && Storage::disk('local')->exists($importBatch->errorFilePath), 404, 'File kesalahan tidak tersedia.');

        return Storage::disk('local')->download($importBatch->errorFilePath, 'import-errors-'.$importBatch->publicId.'.xlsx', ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Cache-Control' => 'private, no-store']);
    }
}

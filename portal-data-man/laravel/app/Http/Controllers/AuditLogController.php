<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AuditLogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'actorType' => ['nullable', Rule::in(['ADMIN', 'TEACHER', 'APPLICATION', 'SYSTEM'])],
            'actorPublicId' => ['nullable', 'string', 'size:26'],
            'action' => ['nullable', 'string', 'max:100'],
            'entityType' => ['nullable', 'string', 'max:100'],
            'entityPublicId' => ['nullable', 'string', 'size:26'],
            'dateFrom' => ['nullable', 'date'],
            'dateTo' => ['nullable', 'date', 'after_or_equal:dateFrom'],
            'page' => ['nullable', 'integer', 'min:1'],
            'perPage' => ['nullable', 'integer', 'between:1,100'],
            'sortDirection' => ['nullable', Rule::in(['asc', 'desc'])],
        ]);
        $query = AuditLog::query()
            ->when($filters['actorType'] ?? null, fn ($q, $v) => $q->where('actorType', $v))
            ->when($filters['actorPublicId'] ?? null, fn ($q, $v) => $q->where('actorPublicId', $v))
            ->when($filters['action'] ?? null, fn ($q, $v) => $q->where('action', 'like', "%{$v}%"))
            ->when($filters['entityType'] ?? null, fn ($q, $v) => $q->where('entityType', $v))
            ->when($filters['entityPublicId'] ?? null, fn ($q, $v) => $q->where('entityPublicId', $v))
            ->when($filters['dateFrom'] ?? null, fn ($q, $v) => $q->where('createdAt', '>=', $v))
            ->when($filters['dateTo'] ?? null, fn ($q, $v) => $q->where('createdAt', '<=', strlen($v) === 10 ? date('Y-m-d 23:59:59', strtotime($v)) : $v));
        $page = $query->orderBy('createdAt', $filters['sortDirection'] ?? 'desc')->paginate($filters['perPage'] ?? 25);

        return ApiResponse::paginated($page, 'Audit log berhasil diambil.');
    }

    public function show(string $publicId): JsonResponse
    {
        return ApiResponse::success(AuditLog::query()->where('publicId', $publicId)->firstOrFail(), 'Audit log berhasil diambil.');
    }
}

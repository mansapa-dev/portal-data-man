<?php

namespace App\Http\Controllers;

use App\Models\AcademicYear;
use App\Services\AuditService;
use App\Support\ApiResponse;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AcademicYearController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(): JsonResponse
    {
        return ApiResponse::success(AcademicYear::query()->withCount(['classes', 'semesters'])->orderByDesc('startDate')->get(), 'Daftar tahun ajaran berhasil diambil.');
    }

    public function show(AcademicYear $academicYear): JsonResponse
    {
        return ApiResponse::success($academicYear, 'Tahun ajaran berhasil diambil.');
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $year = DB::transaction(function () use ($request, $data) {
            if ($data['isActive'] ?? false) {
                AcademicYear::query()->update(['isActive' => false]);
            }$year = AcademicYear::query()->create($data);
            $this->audit->write($request, 'CREATE', 'AcademicYear', $year->publicId, null, $year);

            return $year;
        });

        return ApiResponse::success($year, 'Tahun ajaran berhasil dibuat.', 201);
    }

    public function update(Request $request, AcademicYear $academicYear): JsonResponse
    {
        $data = $this->validated($request, true, $academicYear);
        $old = $academicYear->replicate();
        $academicYear->update($data);
        $this->audit->write($request, 'UPDATE', 'AcademicYear', $academicYear->publicId, $old, $academicYear);

        return ApiResponse::success($academicYear->fresh(), 'Tahun ajaran berhasil diperbarui.');
    }

    public function activate(Request $request, AcademicYear $academicYear): JsonResponse
    {
        DB::transaction(function () use ($request, $academicYear) {
            $old = $academicYear->replicate();
            AcademicYear::query()->where('id', '!=', $academicYear->id)->update(['isActive' => false]);
            $academicYear->update(['isActive' => true]);
            $this->audit->write($request, 'ACTIVATE', 'AcademicYear', $academicYear->publicId, $old, $academicYear);
        });

        return ApiResponse::success($academicYear->fresh(), 'Tahun ajaran berhasil diaktifkan.');
    }

    private function validated(Request $request, bool $partial = false, ?AcademicYear $year = null): array
    {
        $required = $partial ? 'sometimes' : 'required';
        $data = $request->validate(['name' => [$required, 'regex:/^\d{4}\/\d{4}$/', Rule::unique('AcademicYear', 'name')->ignore($year?->id)], 'startDate' => [$required, 'date'], 'endDate' => [$required, 'date'], 'isActive' => ['sometimes', 'boolean']]);
        $start = $data['startDate'] ?? $year?->startDate?->toDateString();
        $end = $data['endDate'] ?? $year?->endDate?->toDateString();
        abort_unless($start && $end && $start < $end,422,'Tanggal mulai harus sebelum tanggal selesai.');
        $startDate = CarbonImmutable::parse($start);
        $endDate = CarbonImmutable::parse($end);
        abort_unless($endDate->equalTo($startDate->addYearNoOverflow()->subDay()), 422, 'Tahun ajaran harus tepat satu tahun (tanggal selesai satu hari sebelum tanggal mulai tahun berikutnya).');
        [$nameStart, $nameEnd] = explode('/', $data['name'] ?? $year?->name);
        abort_unless((int) $nameStart === $startDate->year && (int) $nameEnd === $endDate->year, 422, 'Nama tahun ajaran harus sesuai dengan rentang tanggal.');

        return $data;
    }
}

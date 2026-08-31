<?php

namespace App\Http\Controllers;

use App\Models\AcademicYear;
use App\Models\Semester;
use App\Services\AuditService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SemesterController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(): JsonResponse
    {
        return ApiResponse::success(Semester::query()->with('academicYear')->orderByDesc('startDate')->get(), 'Daftar semester berhasil diambil.');
    }

    public function show(Semester $semester): JsonResponse
    {
        return ApiResponse::success($semester->load('academicYear'), 'Semester berhasil diambil.');
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['academicYearPublicId' => ['required', 'string', 'size:26'], 'type' => ['required', Rule::in(['ODD', 'EVEN'])], 'startDate' => ['required', 'date'], 'endDate' => ['required', 'date']]);
        $year = AcademicYear::query()->where('publicId', $data['academicYearPublicId'])->firstOrFail();
        $this->dates($data['startDate'], $data['endDate'], $year);
        abort_if(Semester::query()->where('academicYearId', $year->id)->where('type', $data['type'])->exists(), 409, 'Semester sudah tersedia.');
        $semester = Semester::query()->create(['academicYearId' => $year->id, 'type' => $data['type'], 'startDate' => $data['startDate'], 'endDate' => $data['endDate'], 'isActive' => false]);
        $this->audit->write($request, 'CREATE', 'Semester', $semester->publicId, null, $semester);

        return ApiResponse::success($semester, 'Semester berhasil dibuat.', 201);
    }

    public function update(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate(['startDate' => ['sometimes', 'date'], 'endDate' => ['sometimes', 'date']]);
        $start = $data['startDate'] ?? $semester->startDate->toDateString();
        $end = $data['endDate'] ?? $semester->endDate->toDateString();
        $this->dates($start, $end, $semester->academicYear);
        $old = $semester->replicate();
        $semester->update($data);
        $this->audit->write($request, 'UPDATE', 'Semester', $semester->publicId, $old, $semester);

        return ApiResponse::success($semester->fresh(), 'Semester berhasil diperbarui.');
    }

    public function activate(Request $request, Semester $semester): JsonResponse
    {
        DB::transaction(function () use ($request, $semester) {
            $old = $semester->replicate();
            Semester::query()->where('id', '!=', $semester->id)->update(['isActive' => false]);
            $semester->update(['isActive' => true]);
            $this->audit->write($request, 'ACTIVATE', 'Semester', $semester->publicId, $old, $semester);
        });

        return ApiResponse::success($semester->fresh(), 'Semester berhasil diaktifkan.');
    }

    private function dates(string $start, string $end, AcademicYear $year): void
    {
        abort_unless($start < $end && $start >= $year->startDate->toDateString() && $end <= $year->endDate->toDateString(),422,'Tanggal semester harus valid dan berada dalam tahun ajaran.');
    }
}

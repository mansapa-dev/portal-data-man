<?php

namespace App\Http\Controllers;

use App\Models\AcademicYear;
use App\Models\ClassEnrollment;
use App\Models\SchoolClass;
use App\Models\Semester;
use App\Services\AuditService;
use App\Support\ApiResponse;
use Carbon\CarbonImmutable;
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
        $this->dates($data['startDate'], $data['endDate'], $year, $data['type']);
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
        $this->dates($start, $end, $semester->academicYear, $semester->type);
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

    public function syncEnrollments(Request $request, Semester $semester): JsonResponse
    {
        // Ambil semua kelas aktif di tahun ajaran yang sama dengan semester target
        $classes = SchoolClass::query()
            ->where('academicYearId', $semester->academicYearId)
            ->where('status', 'ACTIVE')
            ->pluck('id');

        if ($classes->isEmpty()) {
            return ApiResponse::success(['synced' => 0, 'skipped' => 0], 'Tidak ada kelas aktif di tahun ajaran ini.');
        }

        // Cari siswa yang sudah punya enrollment di semester target (untuk di-skip)
        $alreadySynced = ClassEnrollment::query()
            ->where('semesterId', $semester->id)
            ->where('status', 'ACTIVE')
            ->whereIn('schoolClassId', $classes)
            ->pluck('studentId')
            ->flip();

        // Ambil enrollment aktif terbaru per siswa per kelas dari tahun ajaran yang sama,
        // yang BELUM ada di semester target
        $candidates = ClassEnrollment::query()
            ->where('academicYearId', $semester->academicYearId)
            ->where('status', 'ACTIVE')
            ->whereIn('schoolClassId', $classes)
            ->where('semesterId', '!=', $semester->id)
            ->whereNotIn('studentId', $alreadySynced->keys()->all())
            // Ambil enrollment terbaru per siswa (berdasarkan semesterId terbesar sebagai proxy urutan)
            ->orderByDesc('semesterId')
            ->get()
            ->unique('studentId'); // satu enrollment per siswa (yang terbaru)

        $synced = 0;
        $skipped = 0;

        DB::transaction(function () use ($candidates, $semester, &$synced, &$skipped, $request) {
            foreach ($candidates as $source) {
                $key = "{$source->studentId}:{$semester->id}";
                // Cek ulang per-record agar aman dari race condition
                $exists = ClassEnrollment::query()
                    ->where('activeEnrollmentKey', $key)
                    ->exists();

                if ($exists) {
                    $skipped++;
                    continue;
                }

                $enrollment = ClassEnrollment::query()->create([
                    'studentId'           => $source->studentId,
                    'schoolClassId'       => $source->schoolClassId,
                    'academicYearId'      => $semester->academicYearId,
                    'semesterId'          => $semester->id,
                    'attendanceNumber'    => $source->attendanceNumber,
                    'activeEnrollmentKey' => $key,
                    'status'              => 'ACTIVE',
                ]);

                $this->audit->write($request, 'SYNC', 'ClassEnrollment', $enrollment->publicId, null, $enrollment);
                $synced++;
            }
        });

        return ApiResponse::success(
            ['synced' => $synced, 'skipped' => $skipped],
            "Sinkronisasi selesai: {$synced} enrollment dibuat, {$skipped} dilewati (sudah ada)."
        );
    }

    private function dates(string $start, string $end, AcademicYear $year, string $type): void
    {
        $yearStart = CarbonImmutable::parse($year->startDate);
        $expectedStart = $type === 'ODD' ? $yearStart : $yearStart->addMonthsNoOverflow(6);
        $expectedEnd = $type === 'ODD' ? $expectedStart->addMonthsNoOverflow(6)->subDay() : CarbonImmutable::parse($year->endDate);
        abort_unless(CarbonImmutable::parse($start)->equalTo($expectedStart) && CarbonImmutable::parse($end)->equalTo($expectedEnd), 422, 'Semester harus enam bulan: ganjil pada paruh pertama dan genap pada paruh kedua tahun ajaran.');
    }
}

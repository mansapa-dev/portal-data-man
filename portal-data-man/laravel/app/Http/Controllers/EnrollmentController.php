<?php

namespace App\Http\Controllers;

use App\Models\ClassEnrollment;
use App\Models\SchoolClass;
use App\Models\Semester;
use App\Models\Student;
use App\Services\AuditService;
use App\Support\ApiResponse;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class EnrollmentController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function store(Request $request, SchoolClass $schoolClass): JsonResponse
    {
        $data = $request->validate(['studentPublicId' => ['required', 'string', 'size:26'], 'semesterPublicId' => ['nullable', 'string', 'size:26'], 'attendanceNumber' => ['nullable', 'integer', 'min:1']]);
        $student = Student::query()->where('publicId', $data['studentPublicId'])->where('status', 'ACTIVE')->firstOrFail();
        $semester = isset($data['semesterPublicId']) ? Semester::query()->where('publicId', $data['semesterPublicId'])->firstOrFail() : Semester::query()->where('isActive', true)->first();
        abort_unless($semester, 409, 'Semester aktif tidak tersedia.');
        abort_unless($schoolClass->academicYearId === $semester->academicYearId, 409, 'Kelas dan semester berbeda tahun ajaran.');
        try {
            $enrollment = ClassEnrollment::query()->create([
                'studentId' => $student->id,
                'schoolClassId' => $schoolClass->id,
                'academicYearId' => $semester->academicYearId,
                'semesterId' => $semester->id,
                'attendanceNumber' => $data['attendanceNumber'] ?? null,
                'activeEnrollmentKey' => "{$student->id}:{$semester->id}",
                'status' => 'ACTIVE',
            ]);
        } catch (QueryException $error) {
            $this->conflict($error);
        }
        $this->audit->write($request, 'CREATE', 'ClassEnrollment', $enrollment->publicId, null, $enrollment);

        return ApiResponse::success($enrollment->load(['student', 'schoolClass', 'semester']), 'Siswa berhasil ditambahkan ke kelas.', 201);
    }

    public function update(Request $request, ClassEnrollment $classEnrollment): JsonResponse
    {
        $data = $request->validate(['attendanceNumber' => ['sometimes', 'nullable', 'integer', 'min:1'], 'status' => ['sometimes', Rule::in(['ACTIVE', 'MOVED', 'COMPLETED', 'CANCELLED'])], 'leftAt' => ['sometimes', 'nullable', 'date']]);
        $old = $classEnrollment->replicate();
        if (isset($data['status']) && $data['status'] !== 'ACTIVE') {
            $data['activeEnrollmentKey'] = null;
            $data['leftAt'] ??= now();
        }
        try {
            $classEnrollment->update($data);
        } catch (QueryException $error) {
            $this->conflict($error);
        }
        $this->audit->write($request, 'UPDATE', 'ClassEnrollment', $classEnrollment->publicId, $old, $classEnrollment);

        return ApiResponse::success($classEnrollment->fresh(), 'Enrollment berhasil diperbarui.');
    }

    public function move(Request $request, ClassEnrollment $classEnrollment): JsonResponse
    {
        $data = $request->validate(['targetClassPublicId' => ['required', 'string', 'size:26'], 'attendanceNumber' => ['nullable', 'integer', 'min:1']]);
        abort_unless($classEnrollment->status === 'ACTIVE', 409, 'Hanya enrollment aktif yang dapat dipindahkan.');
        $target = SchoolClass::query()->where('publicId', $data['targetClassPublicId'])->where('academicYearId', $classEnrollment->academicYearId)->firstOrFail();
        abort_if($target->id === $classEnrollment->schoolClassId, 409, 'Kelas tujuan sama dengan kelas asal.');
        $old = $classEnrollment->replicate();
        try {
            $created = DB::transaction(function () use ($classEnrollment, $target, $data): ClassEnrollment {
                $classEnrollment->update(['status' => 'MOVED', 'leftAt' => now(), 'activeEnrollmentKey' => null]);

                return ClassEnrollment::query()->create([
                    'studentId' => $classEnrollment->studentId,
                    'schoolClassId' => $target->id,
                    'academicYearId' => $classEnrollment->academicYearId,
                    'semesterId' => $classEnrollment->semesterId,
                    'attendanceNumber' => $data['attendanceNumber'] ?? null,
                    'activeEnrollmentKey' => "{$classEnrollment->studentId}:{$classEnrollment->semesterId}",
                    'status' => 'ACTIVE',
                ]);
            });
        } catch (QueryException $error) {
            $this->conflict($error);
        }
        $this->audit->write($request, 'MOVE', 'ClassEnrollment', $created->publicId, $old, $created);

        return ApiResponse::success($created->load(['student', 'schoolClass', 'semester']), 'Siswa berhasil dipindahkan.');
    }

    public function destroy(Request $request, SchoolClass $schoolClass, Student $student): JsonResponse
    {
        $enrollment = ClassEnrollment::query()->where('schoolClassId', $schoolClass->id)->where('studentId', $student->id)->where('status', 'ACTIVE')->firstOrFail();
        $old = $enrollment->replicate();
        $enrollment->update(['status' => 'CANCELLED', 'leftAt' => now(), 'activeEnrollmentKey' => null]);
        $this->audit->write($request, 'DELETE', 'ClassEnrollment', $enrollment->publicId, $old, $enrollment);

        return response()->json(null, 204);
    }

    public function history(Student $student): JsonResponse
    {
        $rows = $student->enrollments()->with(['schoolClass', 'semester', 'academicYear'])->orderByDesc('enrolledAt')->get();

        return ApiResponse::success($rows, 'Riwayat kelas berhasil diambil.');
    }

    private function conflict(QueryException $error): never
    {
        if (in_array((string) $error->getCode(), ['23000', '23505'], true)) {
            abort(409, 'Siswa sudah mempunyai enrollment aktif atau nomor absen digunakan.');
        }
        throw $error;
    }
}

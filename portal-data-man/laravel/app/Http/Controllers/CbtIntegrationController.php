<?php

namespace App\Http\Controllers;

use App\Models\SchoolClass;
use App\Models\Student;
use App\Models\Teacher;
use App\Models\AcademicYear;
use App\Models\Semester;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CbtIntegrationController extends Controller
{
    public function academicYears(): JsonResponse
    {
        return ApiResponse::success(AcademicYear::query()->orderByDesc('startDate')->get()->map(fn (AcademicYear $year): array => [
            'id' => $year->publicId, 'name' => $year->name, 'is_active' => (bool) $year->isActive,
        ]), 'Tahun ajaran Portal Data berhasil diambil.');
    }

    public function semesters(Request $request): JsonResponse
    {
        $query = Semester::query()->with('academicYear')->orderByDesc('startDate');
        if ($request->filled('academic_year_id')) {
            $query->whereHas('academicYear', fn ($year) => $year->where('publicId', $request->query('academic_year_id')));
        }
        return ApiResponse::success($query->get()->map(fn (Semester $semester): array => [
            'id' => $semester->publicId, 'type' => $semester->type,
            'academic_year_id' => $semester->academicYear?->publicId,
            'academic_year' => $semester->academicYear?->name, 'is_active' => (bool) $semester->isActive,
        ]), 'Semester Portal Data berhasil diambil.');
    }

    public function students(Request $request): JsonResponse
    {
        $limit = min(max((int) $request->query('per_page', 100), 1), 200);
        $page = Student::query()->where('status', 'ACTIVE')->with(['enrollments' => fn ($query) => $query
            ->where('status', 'ACTIVE')->with(['schoolClass', 'academicYear', 'semester'])->latest('id')])->orderBy('id')->paginate($limit);
        $page->getCollection()->transform(function (Student $student): array {
            $enrollment = $student->enrollments->first();

            return ['id' => $student->publicId, 'nisn' => $student->nisn, 'name' => $student->fullName,
                'status' => $student->status, 'is_active' => $student->status === 'ACTIVE',
                'class' => $enrollment?->schoolClass ? ['id' => $enrollment->schoolClass->publicId, 'name' => $enrollment->schoolClass->name] : null,
                'grade' => $enrollment?->schoolClass?->gradeLevel,
                'academic_year_id' => $enrollment?->academicYear?->publicId,
                'academic_year' => $enrollment?->academicYear?->name,
                'semester_id' => $enrollment?->semester?->publicId, 'semester' => $enrollment?->semester?->type];
        });

        return ApiResponse::success($page, 'Referensi siswa CBT berhasil diambil.');
    }

    public function teachers(Request $request): JsonResponse
    {
        $limit = min(max((int) $request->query('per_page', 100), 1), 200);
        $page = Teacher::query()->where('status', 'ACTIVE')->orderBy('id')->paginate($limit);
        $page->getCollection()->transform(fn (Teacher $teacher): array => ['id' => $teacher->publicId,
            'nip' => $teacher->nip, 'nuptk' => $teacher->nuptk, 'name' => $teacher->fullName,
            'status' => $teacher->status, 'is_active' => $teacher->status === 'ACTIVE']);

        return ApiResponse::success($page, 'Referensi guru CBT berhasil diambil.');
    }

    public function classes(Request $request): JsonResponse
    {
        $limit = min(max((int) $request->query('per_page', 100), 1), 200);
        $page = SchoolClass::query()->with('academicYear')->where('status', 'ACTIVE')->orderBy('id')->paginate($limit);
        $page->getCollection()->transform(fn (SchoolClass $class): array => ['id' => $class->publicId,
            'code' => $class->code, 'name' => $class->name, 'grade' => $class->gradeLevel,
            'academic_year_id' => $class->academicYear?->publicId,
            'academic_year' => $class->academicYear?->name, 'status' => $class->status]);

        return ApiResponse::success($page, 'Referensi kelas CBT berhasil diambil.');
    }
}

<?php

namespace App\Http\Controllers;

use App\Models\SchoolClass;
use App\Models\Student;
use App\Models\Teacher;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CbtIntegrationController extends Controller
{
    public function students(Request $request): JsonResponse
    {
        $limit = min(max((int) $request->query('per_page', 100), 1), 200);
        $page = Student::query()->where('status', 'ACTIVE')->with(['enrollments' => fn ($query) => $query
            ->where('status', 'ACTIVE')->with(['schoolClass', 'academicYear'])->latest('id')])->orderBy('id')->paginate($limit);
        $page->getCollection()->transform(function (Student $student): array {
            $enrollment = $student->enrollments->first();

            return ['id' => $student->publicId, 'nisn' => $student->nisn, 'name' => $student->fullName,
                'status' => $student->status, 'is_active' => $student->status === 'ACTIVE',
                'class' => $enrollment?->schoolClass ? ['id' => $enrollment->schoolClass->publicId, 'name' => $enrollment->schoolClass->name] : null,
                'grade' => $enrollment?->schoolClass?->gradeLevel, 'academic_year' => $enrollment?->academicYear?->name];
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
            'academic_year' => $class->academicYear?->name, 'status' => $class->status]);

        return ApiResponse::success($page, 'Referensi kelas CBT berhasil diambil.');
    }
}

<?php

namespace App\Http\Controllers;

use App\Models\SchoolClass;
use App\Models\Student;
use App\Models\Teacher;
use App\Models\AcademicYear;
use App\Models\Employee;
use App\Models\Semester;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CbtIntegrationController extends Controller
{
    public function revisions(?Request $request = null): JsonResponse
    {
        // CBT requests the checksum for one type before and after a sync. Do
        // not hash every large table for a small reference such as AcademicYear:
        // that can exceed the web-server timeout on shared hosting.
        $requestedType = strtoupper((string) ($request?->query('type', '') ?? ''));
        $dependencies = [
            'STUDENTS' => ['Student', 'ClassEnrollment', 'SchoolClass', 'AcademicYear', 'Semester'],
            'TEACHERS' => ['Teacher'],
            'EMPLOYEES' => ['Employee'],
            'CLASSES' => ['SchoolClass', 'AcademicYear'],
            'ACADEMIC_YEARS' => ['AcademicYear'],
            'SEMESTERS' => ['Semester', 'AcademicYear'],
        ];
        if ($requestedType !== '' && ! array_key_exists($requestedType, $dependencies)) {
            return response()->json(['success' => false, 'message' => 'Jenis checksum CBT tidak valid.'], 422);
        }

        // One background CBT worker polls this endpoint; no participant requests.
        // Hash actual reference fields so bulk imports, deletes and same-second
        // edits are detected even when Eloquent events are bypassed.
        $tables = [
            'Student' => ['id', 'publicId', 'nisn', 'fullName', 'status', 'deletedAt'],
            'Teacher' => ['id', 'publicId', 'nip', 'nuptk', 'fullName', 'status', 'deletedAt'],
            'Employee' => ['id', 'publicId', 'nip', 'nuptk', 'employeeNumber', 'fullName', 'position', 'status', 'deletedAt'],
            'ClassEnrollment' => ['id', 'studentId', 'schoolClassId', 'academicYearId', 'semesterId', 'status', 'enrolledAt'],
            'SchoolClass' => ['id', 'publicId', 'code', 'name', 'gradeLevel', 'academicYearId', 'status', 'deletedAt'],
            'AcademicYear' => ['id', 'publicId', 'name', 'isActive', 'startDate'],
            'Semester' => ['id', 'publicId', 'academicYearId', 'type', 'isActive', 'startDate'],
        ];
        if ($requestedType !== '') {
            $tables = array_intersect_key($tables, array_flip($dependencies[$requestedType]));
        }
        $hashes = [];
        foreach ($tables as $table => $columns) {
            $hash = hash_init('sha256');
            foreach (\Illuminate\Support\Facades\DB::table($table)->select($columns)->orderBy('id')->cursor() as $row) {
                hash_update($hash, json_encode($row, JSON_THROW_ON_ERROR)."\n");
            }
            $hashes[$table] = hash_final($hash);
        }
        $revisions = [];
        foreach ($requestedType === '' ? array_keys($dependencies) : [$requestedType] as $type) {
            $revisions[$type] = match ($type) {
                'STUDENTS' => hash('sha256', implode('', array_map(fn (string $table) => $hashes[$table], $dependencies[$type]))),
                'TEACHERS' => $hashes['Teacher'],
                'EMPLOYEES' => $hashes['Employee'],
                'CLASSES' => hash('sha256', $hashes['SchoolClass'].$hashes['AcademicYear']),
                'ACADEMIC_YEARS' => $hashes['AcademicYear'],
                'SEMESTERS' => hash('sha256', $hashes['Semester'].$hashes['AcademicYear']),
            };
        }

        return ApiResponse::success(
            $requestedType === '' ? $revisions : [$requestedType => $revisions[$requestedType]],
            'Versi referensi CBT.'
        );
    }

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
            ->where('status', 'ACTIVE')->with(['schoolClass', 'academicYear', 'semester'])->latest('enrolledAt')->orderByDesc('id')])->orderBy('id')->paginate($limit);
        $page->getCollection()->transform(function (Student $student): array {
            $enrollment = $student->enrollments->first();

            return ['id' => $student->publicId, 'nisn' => $student->nisn, 'name' => $student->fullName,
                'status' => $student->status, 'is_active' => $student->status === 'ACTIVE',
                'class' => $enrollment?->schoolClass ? ['id' => $enrollment->schoolClass->publicId, 'name' => $enrollment->schoolClass->name] : null,
                'grade' => $this->normalizeGrade($enrollment?->schoolClass?->gradeLevel),
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

    public function employees(Request $request): JsonResponse
    {
        $limit = min(max((int) $request->query('per_page', 100), 1), 200);
        $page = Employee::query()->where('status', 'ACTIVE')->orderBy('id')->paginate($limit);
        $page->getCollection()->transform(fn (Employee $employee): array => [
            'id' => $employee->publicId,
            'nip' => $employee->nip,
            'employee_number' => $employee->employeeNumber,
            'name' => $employee->fullName,
            'position' => $employee->position,
            'status' => $employee->status,
            'is_active' => true,
        ]);

        return ApiResponse::success($page, 'Referensi pegawai aktif berhasil diambil.');
    }

    public function classes(Request $request): JsonResponse
    {
        $limit = min(max((int) $request->query('per_page', 100), 1), 200);
        $page = SchoolClass::query()->with('academicYear')->where('status', 'ACTIVE')->orderBy('id')->paginate($limit);
        $page->getCollection()->transform(fn (SchoolClass $class): array => ['id' => $class->publicId,
            'code' => $class->code, 'name' => $class->name, 'grade' => $this->normalizeGrade($class->gradeLevel),
            'academic_year_id' => $class->academicYear?->publicId,
            'academic_year' => $class->academicYear?->name, 'status' => $class->status]);

        return ApiResponse::success($page, 'Referensi kelas CBT berhasil diambil.');
    }

    private function normalizeGrade(mixed $gradeLevel): ?string
    {
        if ($gradeLevel === null || $gradeLevel === '') {
            return null;
        }
        return match ((string) $gradeLevel) {
            '7', 'VII'   => 'VII',
            '8', 'VIII'  => 'VIII',
            '9', 'IX'    => 'IX',
            '10', 'X'    => 'X',
            '11', 'XI'   => 'XI',
            '12', 'XII'  => 'XII',
            default      => strtoupper(trim((string) $gradeLevel)),
        };
    }
}

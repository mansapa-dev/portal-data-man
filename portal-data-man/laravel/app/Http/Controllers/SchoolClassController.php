<?php

namespace App\Http\Controllers;

use App\Models\AcademicYear;
use App\Models\SchoolClass;
use App\Models\Teacher;
use App\Services\AuditService;
use App\Support\ApiResponse;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SchoolClassController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'academicYearPublicId' => ['nullable', 'string', 'size:26'],
            'gradeLevel' => ['nullable', 'integer', 'between:1,13'],
            'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE', 'ARCHIVED'])],
            'page' => ['nullable', 'integer', 'min:1'],
            'perPage' => ['nullable', 'integer', 'between:1,100'],
        ]);
        $query = SchoolClass::query()
            ->with(['academicYear', 'homeroomTeacher'])
            ->withCount(['enrollments as activeStudentsCount' => fn ($query) => $query->where('status', 'ACTIVE')]);
        $query->when($filters['search'] ?? null, fn ($query, $search) => $query->where(fn ($nested) => $nested->where('code', 'like', "%{$search}%")->orWhere('name', 'like', "%{$search}%")));
        $query->when($filters['academicYearPublicId'] ?? null, fn ($query, $id) => $query->whereHas('academicYear', fn ($year) => $year->where('publicId', $id)));
        $query->when($filters['gradeLevel'] ?? null, fn ($query, $grade) => $query->where('gradeLevel', $grade));
        $query->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status));

        return ApiResponse::paginated($query->orderBy('code')->paginate($filters['perPage'] ?? 20), 'Daftar kelas berhasil diambil.');
    }

    public function show(SchoolClass $schoolClass): JsonResponse
    {
        return ApiResponse::success($schoolClass->load(['academicYear', 'homeroomTeacher']), 'Kelas berhasil diambil.');
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $year = AcademicYear::query()->where('publicId', $data['academicYearPublicId'])->firstOrFail();
        $teacher = $this->resolveTeacher($data['homeroomTeacherPublicId'] ?? null, $year->id);
        try {
            $class = SchoolClass::query()->create([
                'academicYearId' => $year->id,
                'code' => $this->normalizeCode($data['code']),
                'name' => trim($data['name']),
                'gradeLevel' => $data['gradeLevel'],
                'homeroomTeacherId' => $teacher?->id,
                'status' => $data['status'] ?? 'ACTIVE',
            ]);
        } catch (QueryException $error) {
            $this->throwConflict($error);
        }
        $this->audit->write($request, 'CREATE', 'SchoolClass', $class->publicId, null, $class);

        return ApiResponse::success($class->load(['academicYear', 'homeroomTeacher']), 'Kelas berhasil dibuat.', 201);
    }

    public function update(Request $request, SchoolClass $schoolClass): JsonResponse
    {
        $data = $this->validated($request, true);
        $teacher = array_key_exists('homeroomTeacherPublicId', $data)
            ? $this->resolveTeacher($data['homeroomTeacherPublicId'], $schoolClass->academicYearId, $schoolClass->id)
            : null;
        $values = collect($data)->only(['name', 'gradeLevel', 'status'])->all();
        if (array_key_exists('code', $data)) {
            $values['code'] = $this->normalizeCode($data['code']);
        }
        if (array_key_exists('name', $values)) {
            $values['name'] = trim($values['name']);
        }
        if (array_key_exists('homeroomTeacherPublicId', $data)) {
            $values['homeroomTeacherId'] = $teacher?->id;
        }
        $old = $schoolClass->replicate();
        try {
            $schoolClass->update($values);
        } catch (QueryException $error) {
            $this->throwConflict($error);
        }
        $this->audit->write($request, 'UPDATE', 'SchoolClass', $schoolClass->publicId, $old, $schoolClass);

        return ApiResponse::success($schoolClass->fresh()->load(['academicYear', 'homeroomTeacher']), 'Kelas berhasil diperbarui.');
    }

    public function destroy(Request $request, SchoolClass $schoolClass): JsonResponse
    {
        $old = $schoolClass->replicate();
        $schoolClass->update(['status' => 'INACTIVE']);
        $schoolClass->delete();
        $this->audit->write($request, 'DELETE', 'SchoolClass', $schoolClass->publicId, $old, $schoolClass);

        return response()->json(null, 204);
    }

    public function restore(Request $request, string $publicId): JsonResponse
    {
        $class = SchoolClass::withTrashed()->where('publicId', $publicId)->firstOrFail();
        $class->restore();
        $this->audit->write($request, 'RESTORE', 'SchoolClass', $class->publicId, null, $class);

        return ApiResponse::success($class, 'Kelas berhasil dipulihkan.');
    }

    public function students(SchoolClass $schoolClass): JsonResponse
    {
        $rows = $schoolClass->enrollments()->where('status', 'ACTIVE')->with(['student', 'semester'])->orderBy('attendanceNumber')->get();

        return ApiResponse::success($rows, 'Anggota kelas berhasil diambil.');
    }

    public function statistics(SchoolClass $schoolClass): JsonResponse
    {
        $counts = $schoolClass->enrollments()->select('status', DB::raw('COUNT(*) as total'))->groupBy('status')->pluck('total', 'status');

        return ApiResponse::success(['classPublicId' => $schoolClass->publicId, 'byStatus' => $counts], 'Statistik kelas berhasil diambil.');
    }

    private function validated(Request $request, bool $partial = false): array
    {
        $required = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'academicYearPublicId' => [$required, 'string', 'size:26'],
            'code' => [$required, 'string', 'max:30'],
            'name' => [$required, 'string', 'max:100'],
            'gradeLevel' => [$required, 'integer', 'between:1,13'],
            'homeroomTeacherPublicId' => ['sometimes', 'nullable', 'string', 'size:26'],
            'status' => ['sometimes', Rule::in(['ACTIVE', 'INACTIVE', 'ARCHIVED'])],
        ]);
    }

    private function resolveTeacher(?string $publicId, int|string $yearId, int|string|null $exceptClassId = null): ?Teacher
    {
        if (blank($publicId)) {
            return null;
        }
        $teacher = Teacher::query()->where('publicId', $publicId)->where('status', 'ACTIVE')->first();
        abort_unless($teacher, 409, 'Wali kelas harus guru aktif.');
        $used = SchoolClass::query()->where('academicYearId', $yearId)->where('homeroomTeacherId', $teacher->id)->where('status', 'ACTIVE')->when($exceptClassId, fn ($query) => $query->whereKeyNot($exceptClassId))->exists();
        abort_if($used, 409, 'Guru sudah menjadi wali kelas aktif pada tahun ajaran ini.');

        return $teacher;
    }

    private function normalizeCode(string $code): string
    {
        return strtoupper((string) preg_replace('/XlI/i', 'XII', trim($code)));
    }

    private function throwConflict(QueryException $error): never
    {
        if (in_array((string) $error->getCode(), ['23000', '23505'], true)) {
            abort(409, 'Kode kelas sudah digunakan pada tahun ajaran ini.');
        }
        throw $error;
    }
}

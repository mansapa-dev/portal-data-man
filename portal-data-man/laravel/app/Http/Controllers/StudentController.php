<?php

namespace App\Http\Controllers;

use App\Models\Student;
use App\Services\AuditService;
use App\Support\ApiResponse;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class StudentController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate(['search' => ['nullable', 'string', 'max:191'], 'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED', 'DROPPED_OUT'])], 'page' => ['nullable', 'integer', 'min:1'], 'perPage' => ['nullable', 'integer', 'min:1', 'max:100'], 'sortDirection' => ['nullable', Rule::in(['asc', 'desc'])]]);
        $query = Student::query();
        if ($search = $validated['search'] ?? null) {
            $query->where(fn ($q) => $q->where('nisn', 'like', "%{$search}%")->orWhere('fullName', 'like', "%{$search}%"));
        }
        if ($status = $validated['status'] ?? null) {
            $query->where('status', $status);
        }
        $page = $query->orderBy('fullName', $validated['sortDirection'] ?? 'asc')->paginate($validated['perPage'] ?? 25);

        return ApiResponse::paginated($page, 'Daftar siswa berhasil diambil.');
    }

    public function show(Student $student): JsonResponse
    {
        return ApiResponse::success($student, 'Siswa berhasil diambil.');
    }

    public function byNisn(string $nisn): JsonResponse
    {
        abort_unless(preg_match('/^\d{10}$/', $nisn), 422, 'NISN wajib 10 digit.');

        return ApiResponse::success(Student::query()->where('nisn', $nisn)->firstOrFail(), 'Siswa berhasil diambil.');
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        try {
            $student = DB::transaction(function () use ($request, $data) {
                $student = Student::query()->create($this->normalize($data));
                $this->audit->write($request, 'CREATE', 'Student', $student->publicId, null, $student);

                return $student;
            });
        } catch (QueryException $e) {
            if ((string) $e->getCode() === '23000') {
                abort(409, 'NISN atau RFID UID sudah digunakan.');
            }throw $e;
        }

        return ApiResponse::success($student, 'Siswa berhasil dibuat.', 201);
    }

    public function update(Request $request, Student $student): JsonResponse
    {
        $data = $this->validated($request, true, $student);
        try {
            $updated = DB::transaction(function () use ($request, $student, $data) {
                $old = $student->replicate();
                $student->fill($this->normalize($data))->save();
                $this->audit->write($request, 'UPDATE', 'Student', $student->publicId, $old, $student);

                return $student->fresh();
            });
        } catch (QueryException $e) {
            if ((string) $e->getCode() === '23000') {
                abort(409, 'NISN atau RFID UID sudah digunakan.');
            }throw $e;
        }

        return ApiResponse::success($updated, 'Siswa berhasil diperbarui.');
    }

    public function destroy(Request $request, Student $student): JsonResponse
    {
        DB::transaction(function () use ($request, $student) {
            $old = $student->replicate();
            $student->delete();
            $this->audit->write($request, 'DELETE', 'Student', $student->publicId, $old, null);
        });

        return ApiResponse::success(null, 'Siswa berhasil dihapus.');
    }

    public function restore(Request $request, string $publicId): JsonResponse
    {
        $student = Student::withTrashed()->where('publicId', $publicId)->firstOrFail();
        abort_unless($student->trashed(), 409, 'Siswa tidak sedang dihapus.');
        DB::transaction(function () use ($request, $student) {
            $student->restore();
            $this->audit->write($request, 'RESTORE', 'Student', $student->publicId, null, $student);
        });

        return ApiResponse::success($student->fresh(), 'Siswa berhasil dipulihkan.');
    }

    private function validated(Request $request, bool $partial = false, ?Student $student = null): array
    {
        $sometimes = $partial ? 'sometimes' : 'required';

        return $request->validate(['nisn' => [$sometimes, 'string', 'regex:/^\d{10}$/', Rule::unique('Student', 'nisn')->ignore($student?->id)], 'fullName' => [$sometimes, 'string', 'min:2', 'max:191'], 'parentPhone' => ['sometimes', 'nullable', 'string', 'max:30'], 'address' => ['sometimes', 'nullable', 'string'], 'rfidUid' => ['sometimes', 'nullable', 'string', 'max:100', Rule::unique('Student', 'rfidUid')->ignore($student?->id)], 'status' => ['sometimes', Rule::in(['ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED', 'DROPPED_OUT'])]]);
    }

    private function normalize(array $data): array
    {
        if (array_key_exists('fullName', $data)) {
            $data['fullName'] = preg_replace('/\s+/u', ' ', trim($data['fullName']));
        }
        foreach (['parentPhone', 'address', 'rfidUid'] as $key) {
            if (array_key_exists($key, $data)) {
                $data[$key] = blank($data[$key]) ? null : trim($data[$key]);
            }
        }
        if (isset($data['rfidUid'])) {
            $data['rfidUid'] = strtoupper($data['rfidUid']);
        }

        return $data;
    }
}

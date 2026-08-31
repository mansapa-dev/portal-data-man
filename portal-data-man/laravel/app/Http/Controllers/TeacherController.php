<?php

namespace App\Http\Controllers;

use App\Models\SchoolClass;
use App\Models\Teacher;
use App\Services\AuditService;
use App\Support\ApiResponse;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TeacherController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate(['search' => ['nullable', 'string', 'max:191'], 'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE', 'RETIRED', 'TRANSFERRED'])], 'accountStatus' => ['nullable', Rule::in(['PENDING_SETUP', 'ACTIVE', 'DISABLED', 'LOCKED'])], 'perPage' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $query = Teacher::query()->with(['account:id,teacherId,status', 'homeroomClasses:id,publicId,homeroomTeacherId,code']);
        if ($search = $data['search'] ?? null) {
            $query->where(fn ($q) => $q->where('fullName', 'like', "%{$search}%")->orWhere('nip', 'like', "%{$search}%")->orWhere('nuptk', 'like', "%{$search}%")->orWhere('employeeNumber', 'like', "%{$search}%"));
        }
        if ($status = $data['status'] ?? null) {
            $query->where('status', $status);
        }
        if ($accountStatus = $data['accountStatus'] ?? null) {
            $query->whereHas('account', fn ($q) => $q->where('status', $accountStatus));
        }

        return ApiResponse::paginated($query->orderBy('fullName')->paginate($data['perPage'] ?? 25), 'Daftar guru berhasil diambil.');
    }

    public function show(Teacher $teacher): JsonResponse
    {
        return ApiResponse::success($teacher->load(['account', 'homeroomClasses']), 'Guru berhasil diambil.');
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        try {
            $teacher = DB::transaction(function () use ($request, $data) {
                $teacher = Teacher::query()->create($this->normalize($data));
                $this->audit->write($request, 'CREATE', 'Teacher', $teacher->publicId, null, $teacher);

                return $teacher;
            });
        } catch (QueryException $e) {
            if ((string) $e->getCode() === '23000') {
                abort(409, 'Identifier atau email guru sudah digunakan.');
            }throw $e;
        }

        return ApiResponse::success($teacher, 'Guru berhasil dibuat.', 201);
    }

    public function update(Request $request, Teacher $teacher): JsonResponse
    {
        $data = $this->validated($request, true, $teacher);
        try {
            $updated = DB::transaction(function () use ($request, $teacher, $data) {
                $old = $teacher->replicate();
                $teacher->fill($this->normalize($data))->save();
                if (($data['status'] ?? 'ACTIVE') !== 'ACTIVE') {
                    $teacher->account()->update(['status' => 'DISABLED', 'disabledAt' => now()]);
                }$this->audit->write($request, 'UPDATE', 'Teacher', $teacher->publicId, $old, $teacher);

                return $teacher->fresh();
            });
        } catch (QueryException $e) {
            if ((string) $e->getCode() === '23000') {
                abort(409, 'Identifier atau email guru sudah digunakan.');
            }throw $e;
        }

        return ApiResponse::success($updated, 'Guru berhasil diperbarui.');
    }

    public function destroy(Request $request, Teacher $teacher): JsonResponse
    {
        abort_if(SchoolClass::query()->where('homeroomTeacherId', $teacher->id)->where('status', 'ACTIVE')->exists(), 409, 'Guru masih menjadi wali kelas aktif.');
        DB::transaction(function () use ($request, $teacher) {
            $old = $teacher->replicate();
            $teacher->account()->update(['status' => 'DISABLED', 'disabledAt' => now()]);
            $teacher->forceFill(['status' => 'INACTIVE'])->save();
            $teacher->delete();
            $this->audit->write($request, 'DELETE', 'Teacher', $teacher->publicId, $old, null);
        });

        return ApiResponse::success(null, 'Guru berhasil dihapus.');
    }

    public function restore(Request $request, string $publicId): JsonResponse
    {
        $teacher = Teacher::withTrashed()->where('publicId', $publicId)->firstOrFail();
        abort_unless($teacher->trashed(), 409, 'Guru tidak sedang dihapus.');
        DB::transaction(function () use ($request, $teacher) {
            $teacher->restore();
            $this->audit->write($request, 'RESTORE', 'Teacher', $teacher->publicId, null, $teacher);
        });

        return ApiResponse::success($teacher->fresh(), 'Guru berhasil dipulihkan.');
    }

    private function validated(Request $request, bool $partial = false, ?Teacher $teacher = null): array
    {
        $required = $partial ? 'sometimes' : 'required';
        $data = $request->validate(['fullName' => [$required, 'string', 'min:2', 'max:191'], 'nip' => ['nullable', 'string', 'max:50', Rule::unique('Teacher', 'nip')->ignore($teacher?->id)], 'nuptk' => ['nullable', 'string', 'max:50', Rule::unique('Teacher', 'nuptk')->ignore($teacher?->id)], 'employeeNumber' => ['nullable', 'string', 'max:50', Rule::unique('Teacher', 'employeeNumber')->ignore($teacher?->id)], 'email' => ['nullable', 'email', 'max:191', Rule::unique('Teacher', 'email')->ignore($teacher?->id)], 'phone' => ['nullable', 'string', 'max:30'], 'address' => ['nullable', 'string'], 'gender' => ['nullable', Rule::in(['MALE', 'FEMALE'])], 'status' => ['sometimes', Rule::in(['ACTIVE', 'INACTIVE', 'RETIRED', 'TRANSFERRED'])]], ['fullName.required' => 'Nama guru wajib diisi.']);
        $identifiers = [$data['nip'] ?? $teacher?->nip, $data['nuptk'] ?? $teacher?->nuptk, $data['employeeNumber'] ?? $teacher?->employeeNumber, $data['email'] ?? $teacher?->email];
        abort_unless(collect($identifiers)->contains(fn ($value) => filled($value)), 422, 'Minimal satu identifier guru wajib diisi.');

        return $data;
    }

    private function normalize(array $data): array
    {
        if (isset($data['fullName'])) {
            $data['fullName'] = preg_replace('/\s+/u', ' ', trim($data['fullName']));
        }
        foreach (['nip', 'nuptk', 'employeeNumber', 'email', 'phone', 'address'] as $key) {
            if (array_key_exists($key,$data)) {
                $data[$key] = blank($data[$key]) ? null : trim($data[$key]);
            }
        }
        if (isset($data['email'])) {
            $data['email'] = strtolower($data['email']);
        }

return $data;
    }
}

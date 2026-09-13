<?php

namespace App\Http\Controllers;

use App\Models\Employee;
use App\Services\AuditService;
use App\Support\ApiResponse;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

class EmployeeController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:191'],
            'employmentType' => ['nullable', Rule::in(['PNS', 'PPPK', 'HONORER'])],
            'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE'])],
            'perPage' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $query = Employee::query()
            ->when(Schema::hasTable('TeacherAccount') && Schema::hasColumn('TeacherAccount', 'employeeId'), fn ($query) => $query->with('account'))
            ->when($data['search'] ?? null, fn ($query, $value) => $query->where(fn ($nested) => $nested
                ->where('fullName', 'like', "%{$value}%")
                ->orWhere('nip', 'like', "%{$value}%")
                ->orWhere('nuptk', 'like', "%{$value}%")
                ->orWhere('position', 'like', "%{$value}%")))
            ->when($data['employmentType'] ?? null, fn ($query, $value) => $query->where('employmentType', $value))
            ->when($data['status'] ?? null, fn ($query, $value) => $query->where('status', $value))
            ->orderBy('fullName');

        return ApiResponse::paginated($query->paginate($data['perPage'] ?? 25), 'Daftar pegawai berhasil diambil.');
    }

    public function show(Employee $employee): JsonResponse
    {
        if (Schema::hasTable('TeacherAccount') && Schema::hasColumn('TeacherAccount', 'employeeId')) {
            $employee->load('account');
        }

        return ApiResponse::success($employee, 'Pegawai berhasil diambil.');
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        try {
            $employee = DB::transaction(function () use ($request, $data): Employee {
                $employee = Employee::query()->create($this->normalize($data));
                $this->audit->write($request, 'CREATE', 'Employee', $employee->publicId, null, $employee);

                return $employee;
            });
        } catch (QueryException $error) {
            $this->handleDuplicate($error);
        }

        return ApiResponse::success($employee, 'Pegawai berhasil dibuat.', 201);
    }

    public function update(Request $request, Employee $employee): JsonResponse
    {
        $data = $this->validated($request, true, $employee);
        try {
            $updated = DB::transaction(function () use ($request, $employee, $data): Employee {
                $old = $employee->replicate();
                $employee->fill($this->normalize($data))->save();
                if ($employee->status === 'INACTIVE' && Schema::hasTable('TeacherAccount') && Schema::hasColumn('TeacherAccount', 'employeeId') && $employee->account) {
                    $employee->account->forceFill(['status' => 'DISABLED', 'disabledAt' => now()])->save();
                    $employee->account->sessions()->whereNull('revokedAt')->update(['revokedAt' => now()]);
                    $employee->applicationAccess()->update(['status' => 'INACTIVE']);
                }
                $this->audit->write($request, 'UPDATE', 'Employee', $employee->publicId, $old, $employee);

                return $employee->fresh();
            });
        } catch (QueryException $error) {
            $this->handleDuplicate($error);
        }

        return ApiResponse::success($updated, 'Pegawai berhasil diperbarui.');
    }

    public function destroy(Request $request, Employee $employee): JsonResponse
    {
        DB::transaction(function () use ($request, $employee): void {
            $old = $employee->replicate();
            $employee->forceFill(['status' => 'INACTIVE'])->save();
            if (Schema::hasTable('TeacherAccount') && Schema::hasColumn('TeacherAccount', 'employeeId') && $employee->account) {
                $employee->account->forceFill(['status' => 'DISABLED', 'disabledAt' => now()])->save();
                $employee->account->sessions()->whereNull('revokedAt')->update(['revokedAt' => now()]);
                $employee->applicationAccess()->update(['status' => 'INACTIVE']);
            }
            $employee->delete();
            $this->audit->write($request, 'DELETE', 'Employee', $employee->publicId, $old, null);
        });

        return ApiResponse::success(null, 'Pegawai berhasil dihapus.');
    }

    public function restore(Request $request, string $publicId): JsonResponse
    {
        $employee = Employee::withTrashed()->where('publicId', $publicId)->firstOrFail();
        abort_unless($employee->trashed(), 409, 'Pegawai tidak sedang dihapus.');
        DB::transaction(function () use ($request, $employee): void {
            $employee->restore();
            $this->audit->write($request, 'RESTORE', 'Employee', $employee->publicId, null, $employee);
        });

        return ApiResponse::success($employee->fresh(), 'Pegawai berhasil dipulihkan.');
    }

    private function validated(Request $request, bool $partial = false, ?Employee $employee = null): array
    {
        $required = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'employmentType' => [$required, Rule::in(['PNS', 'PPPK', 'HONORER'])],
            'fullName' => [$required, 'string', 'min:2', 'max:191'],
            'nip' => [$required, 'string', 'max:50', Rule::unique('Employee', 'nip')->ignore($employee?->id)],
            'nuptk' => ['nullable', 'string', 'max:50', Rule::unique('Employee', 'nuptk')->ignore($employee?->id)],
            'position' => [$required, 'string', 'max:191'],
            'rank' => ['nullable', 'string', 'max:100'],
            'gender' => ['nullable', Rule::in(['MALE', 'FEMALE'])],
            'education' => ['nullable', 'string', 'max:191'],
            'grade' => ['nullable', 'string', 'max:100'],
            'status' => ['sometimes', Rule::in(['ACTIVE', 'INACTIVE'])],
        ], [
            'employmentType.required' => 'Jenis pegawai wajib dipilih.',
            'fullName.required' => 'Nama pegawai wajib diisi.',
            'nip.required' => 'NIP wajib diisi.',
            'position.required' => 'Jabatan wajib diisi.',
        ]);
    }

    private function normalize(array $data): array
    {
        foreach (['fullName', 'nip', 'nuptk', 'position', 'rank', 'education', 'grade'] as $field) {
            if (array_key_exists($field, $data)) {
                $value = preg_replace('/\s+/u', ' ', trim((string) $data[$field]));
                $data[$field] = $value === '' ? null : $value;
            }
        }

        return $data;
    }

    private function handleDuplicate(QueryException $error): never
    {
        if ((string) $error->getCode() === '23000') {
            abort(409, 'NIP atau NUPTK sudah digunakan pegawai lain.');
        }
        throw $error;
    }
}

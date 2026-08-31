<?php

namespace App\Http\Controllers;

use App\Models\AdminUser;
use App\Services\AuditService;
use App\Services\PortalSessionService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class AdminUserController extends Controller
{
    public function __construct(private readonly AuditService $audit, private readonly PortalSessionService $sessions) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate(['search' => ['nullable', 'string'], 'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE', 'LOCKED'])], 'role' => ['nullable', Rule::in(['SUPER_ADMIN', 'DATA_ADMIN', 'DATA_OPERATOR', 'AUDITOR'])], 'deleted' => ['nullable', Rule::in(['active', 'deleted', 'all'])], 'page' => ['nullable', 'integer', 'min:1'], 'perPage' => ['nullable', 'integer', 'between:1,100']]);
        $query = AdminUser::query();
        if (($filters['deleted'] ?? 'active') === 'deleted') {
            $query->onlyTrashed();
        } elseif (($filters['deleted'] ?? 'active') === 'all') {
            $query->withTrashed();
        }
        $query->when($filters['search'] ?? null, fn ($query, $value) => $query->where(fn ($nested) => $nested->where('name', 'like', "%{$value}%")->orWhere('email', 'like', "%{$value}%")))->when($filters['status'] ?? null, fn ($query, $value) => $query->where('status', $value))->when($filters['role'] ?? null, fn ($query, $value) => $query->where('role', $value));

        return ApiResponse::paginated($query->orderBy('name')->paginate($filters['perPage'] ?? 25), 'Daftar pengguna admin berhasil diambil.');
    }

    public function show(string $publicId): JsonResponse
    {
        return ApiResponse::success(AdminUser::withTrashed()->where('publicId', $publicId)->firstOrFail(), 'Pengguna admin berhasil diambil.');
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'min:2', 'max:150'], 'email' => ['required', 'email', 'max:191', 'unique:AdminUser,email'], 'password' => ['required', Password::min(12)->mixedCase()->numbers()], 'role' => ['required', Rule::in(['SUPER_ADMIN', 'DATA_ADMIN', 'DATA_OPERATOR', 'AUDITOR'])]]);
        $admin = AdminUser::query()->create(['name' => trim($data['name']), 'email' => strtolower($data['email']), 'passwordHash' => Hash::make($data['password']), 'role' => $data['role'], 'status' => 'ACTIVE']);
        $this->audit->write($request, 'CREATE', 'AdminUser', $admin->publicId, null, $admin);

        return ApiResponse::success($admin, 'Pengguna admin berhasil dibuat.', 201);
    }

    public function update(Request $request, string $publicId): JsonResponse
    {
        $admin = AdminUser::withTrashed()->where('publicId', $publicId)->firstOrFail();
        $data = $request->validate(['name' => ['sometimes', 'string', 'min:2', 'max:150'], 'email' => ['sometimes', 'email', 'max:191', Rule::unique('AdminUser', 'email')->ignore($admin->id)], 'role' => ['sometimes', Rule::in(['SUPER_ADMIN', 'DATA_ADMIN', 'DATA_OPERATOR', 'AUDITOR'])]]);
        $old = $admin->replicate();
        $admin->update([...$data, ...isset($data['name']) ? ['name' => trim($data['name'])] : [], ...isset($data['email']) ? ['email' => strtolower($data['email'])] : []]);
        $this->audit->write($request, 'UPDATE', 'AdminUser', $admin->publicId, $old, $admin);

        return ApiResponse::success($admin->fresh(), 'Pengguna admin berhasil diperbarui.');
    }

    public function destroy(Request $request, string $publicId): JsonResponse
    {
        $admin = AdminUser::query()->where('publicId', $publicId)->firstOrFail();
        $this->assertMayDisable($request, $admin);
        DB::transaction(function () use ($request, $admin): void {
            $old = $admin->replicate();
            $this->sessions->revokeAdmin($admin);
            $admin->update(['status' => 'INACTIVE']);
            $admin->delete();
            $this->audit->write($request, 'DELETE', 'AdminUser', $admin->publicId, $old, $admin);
        });

        return response()->json(null, 204);
    }

    public function restore(Request $request, string $publicId): JsonResponse
    {
        $admin = AdminUser::onlyTrashed()->where('publicId', $publicId)->firstOrFail();
        $admin->restore();
        $this->audit->write($request, 'RESTORE', 'AdminUser', $admin->publicId, null, $admin);

        return ApiResponse::success($admin, 'Pengguna admin berhasil dipulihkan.');
    }

    public function activate(Request $request, string $publicId): JsonResponse
    {
        return $this->changeStatus($request, $publicId, 'ACTIVE');
    }

    public function deactivate(Request $request, string $publicId): JsonResponse
    {
        return $this->changeStatus($request, $publicId, 'INACTIVE');
    }

    private function changeStatus(Request $request, string $publicId, string $status): JsonResponse
    {
        $admin = AdminUser::query()->where('publicId', $publicId)->firstOrFail();
        if ($status !== 'ACTIVE') {
            $this->assertMayDisable($request, $admin);
            $this->sessions->revokeAdmin($admin);
        }
        $old = $admin->replicate();
        $admin->update(['status' => $status, 'failedLoginAttempts' => 0, 'lockedUntil' => null]);
        $this->audit->write($request, $status === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE', 'AdminUser', $admin->publicId, $old, $admin);

        return ApiResponse::success($admin, $status === 'ACTIVE' ? 'Pengguna admin diaktifkan.' : 'Pengguna admin dinonaktifkan.');
    }

    private function assertMayDisable(Request $request, AdminUser $admin): void
    {
        abort_if($request->user('admin')->is($admin), 409, 'Tidak dapat menonaktifkan atau menghapus akun sendiri.');
        abort_if($admin->role === 'SUPER_ADMIN' && $admin->status === 'ACTIVE' && AdminUser::query()->where('role', 'SUPER_ADMIN')->where('status', 'ACTIVE')->count() <= 1, 409, 'Super admin aktif terakhir tidak dapat dinonaktifkan.');
    }
}

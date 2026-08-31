<?php

namespace App\Http\Controllers;

use App\Models\AuthSession;
use App\Services\AuditService;
use App\Services\PortalSessionService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class AdminProfileController extends Controller
{
    public function __construct(private readonly PortalSessionService $sessions, private readonly AuditService $audit) {}

    public function show(Request $request): JsonResponse
    {
        return ApiResponse::success($request->user('admin'), 'Profil berhasil diambil.');
    }

    public function update(Request $request): JsonResponse
    {
        $admin = $request->user('admin');
        $data = $request->validate(['name' => ['required', 'string', 'min:2', 'max:150'], 'email' => ['required', 'email', 'max:191', Rule::unique('AdminUser', 'email')->ignore($admin->id)]]);
        $old = $admin->replicate();
        $admin->update(['name' => preg_replace('/\s+/u', ' ', trim($data['name'])), 'email' => strtolower($data['email'])]);
        $this->audit->write($request, 'PROFILE_UPDATED', 'AdminUser', $admin->publicId, $old, $admin);

        return ApiResponse::success($admin->fresh(), 'Profil berhasil diperbarui.');
    }

    public function changePassword(Request $request): JsonResponse
    {
        $data = $request->validate(['currentPassword' => ['required', 'string'], 'newPassword' => ['required', Password::min(12)->mixedCase()->numbers(), 'confirmed']]);
        $admin = $request->user('admin');
        abort_unless(Hash::check($data['currentPassword'], $admin->passwordHash), 401, 'Password saat ini tidak valid.');
        abort_if(Hash::check($data['newPassword'], $admin->passwordHash), 409, 'Password baru harus berbeda.');
        $current = $request->session()->get('portal_session_public_id');
        $admin->update(['passwordHash' => Hash::make($data['newPassword']), 'passwordChangedAt' => now()]);
        $this->sessions->revokeAdmin($admin, is_string($current) ? $current : null);
        $this->audit->write($request, 'PASSWORD_CHANGED', 'AdminUser', $admin->publicId);

        return ApiResponse::success(null, 'Password berhasil diubah dan session lain telah dicabut.');
    }

    public function sessions(Request $request): JsonResponse
    {
        return ApiResponse::success($this->sessions->safeList($request->user('admin'), $request), 'Daftar session berhasil diambil.');
    }

    public function revokeSession(Request $request, string $publicId): JsonResponse
    {
        $admin = $request->user('admin');
        $count = AuthSession::query()->where('publicId', $publicId)->where('adminUserId', $admin->id)->whereNull('revokedAt')->update(['revokedAt' => now()]);
        abort_unless($count === 1, 404, 'Session tidak ditemukan.');
        $this->audit->write($request, 'SESSION_REVOKED', 'AuthSession', $publicId);

        return ApiResponse::success(null, 'Session berhasil dicabut.');
    }

    public function logoutAll(Request $request): JsonResponse
    {
        $count = $this->sessions->revokeAdmin($request->user('admin'));
        $this->audit->write($request, 'LOGOUT_ALL', 'AdminUser', $request->user('admin')->publicId, null, ['count' => $count]);

        return ApiResponse::success(null, 'Seluruh session telah dicabut.');
    }
}

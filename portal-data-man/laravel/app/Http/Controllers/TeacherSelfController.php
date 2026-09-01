<?php

namespace App\Http\Controllers;

use App\Models\AuthSession;
use App\Services\AuditService;
use App\Services\PortalSessionService;
use App\Services\TeacherPhotoService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TeacherSelfController extends Controller
{
    public function __construct(private readonly PortalSessionService $sessions, private readonly TeacherPhotoService $photos, private readonly AuditService $audit) {}

    public function profile(Request $request): JsonResponse
    {
        $account = $request->user('teacher')->load('teacher');
        $teacher = $account->teacher;

        return ApiResponse::success(['teacherPublicId' => $teacher->publicId, 'accountPublicId' => $account->publicId, 'username' => $account->username, 'email' => $account->email ?? $teacher->email, 'fullName' => $teacher->fullName, 'nip' => $teacher->nip, 'nuptk' => $teacher->nuptk, 'employeeNumber' => $teacher->employeeNumber, 'gender' => $teacher->gender, 'phone' => $teacher->phone, 'address' => $teacher->address, 'photoUrl' => $teacher->photoPath ? '/api/v1/teacher/profile/photo' : null, 'teacherStatus' => $teacher->status, 'accountStatus' => $account->status, 'lastLoginAt' => $account->lastLoginAt], 'Profil guru berhasil diambil.');
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['nullable', 'email', 'max:191'], 'phone' => ['nullable', 'string', 'max:30'], 'address' => ['nullable', 'string', 'max:5000']]);
        $account = $request->user('teacher');
        $teacher = $account->teacher;
        $old = $teacher->replicate();
        $teacher->update(['email' => isset($data['email']) ? strtolower($data['email']) : null, 'phone' => $data['phone'] ?? null, 'address' => $data['address'] ?? null]);
        $account->update(['email' => isset($data['email']) ? strtolower($data['email']) : null]);
        $this->audit->write($request, 'TEACHER_PROFILE_UPDATED', 'Teacher', $teacher->publicId, $old, $teacher);

        return $this->profile($request);
    }

    public function changePassword(Request $request): JsonResponse
    {
        $data = $request->validate(['currentPassword' => ['required', 'string'], 'newPassword' => ['required', Password::min(10)->mixedCase()->numbers()], 'confirmation' => ['required', 'same:newPassword']]);
        $account = $request->user('teacher');
        abort_unless($account->passwordHash && Hash::check($data['currentPassword'], $account->passwordHash), 401, 'Password saat ini tidak valid.');
        abort_if(Hash::check($data['newPassword'], $account->passwordHash), 409, 'Password baru harus berbeda.');
        $current = $request->session()->get('portal_session_public_id');
        $account->update(['passwordHash' => Hash::make($data['newPassword']), 'initialPassword' => null, 'passwordChangedAt' => now(), 'mustChangePassword' => false]);
        $this->sessions->revokeTeacher($account, is_string($current) ? $current : null);
        $this->audit->write($request, 'TEACHER_PASSWORD_CHANGED', 'TeacherAccount', $account->publicId);

        return ApiResponse::success(null, 'Password berhasil diubah dan session lain telah dicabut.');
    }

    public function sessions(Request $request): JsonResponse
    {
        return ApiResponse::success($this->sessions->safeList($request->user('teacher'), $request), 'Daftar session berhasil diambil.');
    }

    public function applications(Request $request): JsonResponse
    {
        $access = $request->user('teacher')->teacher->applicationAccess()
            ->with('application')
            ->where('status', 'ACTIVE')
            ->whereHas('application', fn ($query) => $query->where('status', 'ACTIVE'))
            ->orderBy('createdAt')
            ->get()
            ->map(function ($item): array {
                $application = $item->application;

                return [
                    'publicId' => $application->publicId,
                    'name' => $application->name,
                    'slug' => $application->slug,
                    'description' => $application->description,
                    'role' => $item->role,
                    'launchUrl' => $this->applicationOrigin($application->allowedOrigins ?: $application->redirectUris),
                ];
            })
            ->values();

        return ApiResponse::success($access, 'Daftar aplikasi guru berhasil diambil.');
    }

    public function revokeSession(Request $request, string $publicId): JsonResponse
    {
        $account = $request->user('teacher');
        $count = AuthSession::query()->where('publicId', $publicId)->where('teacherAccountId', $account->id)->whereNull('revokedAt')->update(['revokedAt' => now()]);
        abort_unless($count === 1, 404, 'Session tidak ditemukan.');
        $this->audit->write($request, 'TEACHER_SESSION_REVOKED', 'AuthSession', $publicId);

        return ApiResponse::success(null, 'Session berhasil dicabut.');
    }

    public function logoutAll(Request $request): JsonResponse
    {
        $account = $request->user('teacher');
        $count = $this->sessions->revokeTeacher($account);
        $this->audit->write($request, 'TEACHER_SESSIONS_REVOKED', 'TeacherAccount', $account->publicId, null, ['count' => $count]);

        return ApiResponse::success(null, 'Seluruh session telah dicabut.');
    }

    public function storePhoto(Request $request): JsonResponse
    {
        $request->validate(['file' => ['required', 'file', 'max:2048']]);
        $teacher = $request->user('teacher')->teacher;
        $result = $this->photos->store($teacher, $request->file('file'));
        $this->audit->write($request, 'UPDATE_PHOTO', 'Teacher', $teacher->publicId, null, ['actorType' => 'TEACHER', 'mimeType' => $result['mimeType']]);

        return ApiResponse::success(['url' => '/api/v1/teacher/profile/photo'], 'Foto profil berhasil diperbarui.');
    }

    public function photo(Request $request): StreamedResponse
    {
        return $this->photos->response($request->user('teacher')->teacher);
    }

    private function applicationOrigin(array $uris): ?string
    {
        foreach ($uris as $uri) {
            $parts = is_string($uri) ? parse_url($uri) : false;
            if (! is_array($parts) || ! in_array($parts['scheme'] ?? '', ['https', 'http'], true) || empty($parts['host'])) {
                continue;
            }
            $port = isset($parts['port']) ? ':'.$parts['port'] : '';

            return $parts['scheme'].'://'.$parts['host'].$port;
        }

        return null;
    }
}

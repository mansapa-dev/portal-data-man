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
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TeacherSelfController extends Controller
{
    public function __construct(private readonly PortalSessionService $sessions, private readonly TeacherPhotoService $photos, private readonly AuditService $audit) {}

    public function profile(Request $request): JsonResponse
    {
        $account = $request->user('teacher')->load(['teacher', 'employee']);
        $person = $account->person();
        abort_unless($person, 401, 'Identitas akun tidak tersedia.');
        $employee = $account->employee;
        $teacher = $account->teacher;

        return ApiResponse::success([
            'personPublicId' => $person->publicId,
            'teacherPublicId' => $teacher?->publicId,
            'employeePublicId' => $employee?->publicId,
            'accountType' => $account->accountType(),
            'accountPublicId' => $account->publicId,
            'username' => $account->username,
            'email' => $account->email ?? $teacher?->email,
            'fullName' => $person->fullName,
            'nip' => $person->nip,
            'nuptk' => $person->nuptk,
            'employeeNumber' => $teacher?->employeeNumber,
            'gender' => $person->gender,
            'phone' => $teacher?->phone,
            'address' => $teacher?->address,
            'employmentType' => $employee?->employmentType,
            'position' => $employee?->position,
            'rank' => $employee?->rank,
            'education' => $employee?->education,
            'grade' => $employee?->grade,
            'photoUrl' => $teacher?->photoPath ? '/api/v1/teacher/profile/photo' : null,
            'personStatus' => $person->status,
            'teacherStatus' => $teacher?->status,
            'accountStatus' => $account->status,
            'lastLoginAt' => $account->lastLoginAt,
        ], 'Profil akun berhasil diambil.');
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $account = $request->user('teacher');
        $person = $account->person();
        abort_unless($person, 401, 'Identitas akun tidak tersedia.');
        $teacher = $account->teacher;
        $data = $request->validate([
            'fullName' => ['required', 'string', 'min:2', 'max:191'],
            'gender' => ['nullable', Rule::in(['MALE', 'FEMALE'])],
            'email' => ['nullable', 'email', 'max:191', Rule::unique('Teacher', 'email')->ignore($teacher?->id), Rule::unique('TeacherAccount', 'email')->ignore($account->id)],
            'phone' => ['nullable', 'string', 'max:30'],
            'address' => ['nullable', 'string', 'max:5000'],
        ]);
        $old = $person->replicate();
        $personData = ['fullName' => preg_replace('/\s+/u', ' ', trim($data['fullName'])), 'gender' => $data['gender'] ?? null];
        if ($teacher) {
            $personData += ['email' => isset($data['email']) ? strtolower($data['email']) : null, 'phone' => $data['phone'] ?? null, 'address' => $data['address'] ?? null];
        }
        $person->update($personData);
        $account->update(['email' => isset($data['email']) ? strtolower($data['email']) : null]);
        $this->audit->write($request, $teacher ? 'TEACHER_PROFILE_UPDATED' : 'EMPLOYEE_PROFILE_UPDATED', $teacher ? 'Teacher' : 'Employee', $person->publicId, $old, $person);

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
        $this->audit->write($request, $account->accountType().'_PASSWORD_CHANGED', 'TeacherAccount', $account->publicId);

        return ApiResponse::success(null, 'Password berhasil diubah dan session lain telah dicabut.');
    }

    public function sessions(Request $request): JsonResponse
    {
        return ApiResponse::success($this->sessions->safeList($request->user('teacher'), $request), 'Daftar session berhasil diambil.');
    }

    public function applications(Request $request): JsonResponse
    {
        $account = $request->user('teacher')->load(['teacher', 'employee']);
        $person = $account->person();
        abort_unless($person, 401, 'Identitas akun tidak tersedia.');
        $access = $person->applicationAccess()
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
                    'launchUrl' => $this->applicationLaunchUrl($application->launchUrl, $application->redirectUris, $application->slug),
                ];
            })
            ->values();

        return ApiResponse::success($access, 'Daftar aplikasi akun berhasil diambil.');
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
        abort_unless($teacher, 404, 'Foto profil hanya tersedia untuk akun guru.');
        $result = $this->photos->store($teacher, $request->file('file'));
        $this->audit->write($request, 'UPDATE_PHOTO', 'Teacher', $teacher->publicId, null, ['actorType' => 'TEACHER', 'mimeType' => $result['mimeType']]);

        return ApiResponse::success(['url' => '/api/v1/teacher/profile/photo'], 'Foto profil berhasil diperbarui.');
    }

    public function photo(Request $request): StreamedResponse
    {
        $teacher = $request->user('teacher')->teacher;
        abort_unless($teacher, 404, 'Foto profil hanya tersedia untuk akun guru.');

        return $this->photos->response($teacher);
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

    private function applicationLaunchUrl(?string $configured, array $redirectUris, string $slug = ''): ?string
    {
        $normalizedSlug = strtolower($slug);
        $isJunkes = str_contains($normalizedSlug, 'jurnal')
            || str_contains($normalizedSlug, 'junkes')
            || str_contains($normalizedSlug, 'agen');

        if ($isJunkes && $configured && filter_var($configured, FILTER_VALIDATE_URL) && in_array(parse_url($configured, PHP_URL_PATH) ?: '/', ['', '/'], true)) {
            return rtrim($configured, '/').'/auth/sso/redirect';
        }
        if ($configured && filter_var($configured, FILTER_VALIDATE_URL)) {
            return $configured;
        }
        foreach ($redirectUris as $uri) {
            if (is_string($uri) && str_ends_with(parse_url($uri, PHP_URL_PATH) ?: '', '/auth/sso/callback')) {
                $ssoBase = substr($uri, 0, -strlen('/callback'));
                if ($isJunkes) {
                    return $ssoBase.'/redirect';
                }
                if (str_contains($normalizedSlug, 'cbt')) {
                    return $ssoBase.'/start';
                }
            }
        }

        return $this->applicationOrigin($redirectUris);
    }
}

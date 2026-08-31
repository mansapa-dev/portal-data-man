<?php

namespace App\Http\Controllers;

use App\Mail\TeacherActivationMail;
use App\Models\Teacher;
use App\Models\TeacherAccount;
use App\Models\TeacherPasswordSetupToken;
use App\Services\AuditService;
use App\Services\PortalSessionService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class TeacherAccountController extends Controller
{
    public function __construct(private readonly AuditService $audit, private readonly PortalSessionService $sessions) {}

    public function show(Teacher $teacher): JsonResponse
    {
        return ApiResponse::success($teacher->account, 'Akun guru berhasil diambil.');
    }

    public function store(Request $request, Teacher $teacher): JsonResponse
    {
        abort_if($teacher->status !== 'ACTIVE', 409, 'Akun hanya dapat dibuat untuk guru aktif.');
        abort_if($teacher->account()->exists(), 409, 'Guru sudah memiliki akun.');
        $email = $request->validate(['email' => ['nullable', 'email', 'max:191']])['email'] ?? $teacher->email;
        $username = $this->availableUsername($teacher);
        $raw = Str::random(64);
        $account = DB::transaction(function () use ($request, $teacher, $email, $username, $raw) {
            $account = $teacher->account()->create(['publicId' => (string) Str::ulid(), 'username' => $username, 'email' => $email ? strtolower($email) : null, 'passwordHash' => null, 'status' => 'PENDING_SETUP']);
            TeacherPasswordSetupToken::query()->create(['publicId' => (string) Str::ulid(), 'teacherAccountId' => $account->id, 'tokenHash' => hash('sha256', $raw), 'expiresAt' => now()->addDay()]);
            $this->audit->write($request, 'TEACHER_ACCOUNT_PROVISIONED', 'TeacherAccount', $account->publicId, null, ['teacherPublicId' => $teacher->publicId, 'username' => $username, 'email' => $email]);

            return $account;
        });
        $setupUrl = url('/teacher/setup-password?token='.urlencode($raw));
        $mailStatus = $this->mail($account, $setupUrl);

        return ApiResponse::success(['account' => $account, 'passwordSetupUrl' => $setupUrl, 'mailStatus' => $mailStatus], 'Akun guru berhasil dibuat.', 201);
    }

    public function regenerate(Request $request, Teacher $teacher): JsonResponse
    {
        $account = $teacher->account;
        abort_unless($account, 404, 'Akun guru belum tersedia.');
        abort_unless($account->status === 'PENDING_SETUP', 409, 'Token setup hanya untuk akun yang menunggu setup.');
        $raw = Str::random(64);
        DB::transaction(function () use ($request, $account, $raw) {
            TeacherPasswordSetupToken::query()->where('teacherAccountId', $account->id)->whereNull('usedAt')->update(['usedAt' => now()]);
            TeacherPasswordSetupToken::query()->create(['publicId' => (string) Str::ulid(), 'teacherAccountId' => $account->id, 'tokenHash' => hash('sha256', $raw), 'expiresAt' => now()->addDay()]);
            $this->audit->write($request, 'SETUP_TOKEN_REGENERATED', 'TeacherAccount', $account->publicId);
        });
        $setupUrl = url('/teacher/setup-password?token='.urlencode($raw));

        return ApiResponse::success(['passwordSetupUrl' => $setupUrl, 'mailStatus' => $this->mail($account, $setupUrl)], 'Token setup berhasil dibuat ulang.');
    }

    public function disable(Request $request, Teacher $teacher): JsonResponse
    {
        return $this->status($request, $teacher, 'DISABLED', 'Akun guru dinonaktifkan.');
    }

    public function unlock(Request $request, Teacher $teacher): JsonResponse
    {
        return $this->status($request, $teacher, 'ACTIVE', 'Kunci akun guru dibuka.', true);
    }

    public function enable(Request $request, Teacher $teacher): JsonResponse
    {
        abort_unless($teacher->status === 'ACTIVE' && $teacher->account?->passwordHash, 409, 'Guru harus aktif dan password sudah diatur.');

        return $this->status($request, $teacher, 'ACTIVE', 'Akun guru diaktifkan.', true);
    }

    public function revokeSessions(Request $request, Teacher $teacher): JsonResponse
    {
        abort_unless($teacher->account, 404, 'Akun guru belum tersedia.');
        $count = $this->sessions->revokeTeacher($teacher->account);
        $this->audit->write($request, 'TEACHER_SESSIONS_REVOKED', 'TeacherAccount', $teacher->account->publicId, null, ['count' => $count]);

        return ApiResponse::success(null, 'Seluruh session guru berhasil dicabut.');
    }

    private function status(Request $request, Teacher $teacher, string $status, string $message, bool $reset = false): JsonResponse
    {
        $account = $teacher->account;
        abort_unless($account, 404, 'Akun guru belum tersedia.');
        $account->forceFill(['status' => $status, 'disabledAt' => $status === 'DISABLED' ? now() : null, ...($reset ? ['failedLoginAttempts' => 0, 'lockedUntil' => null] : [])])->save();
        $this->audit->write($request, 'TEACHER_ACCOUNT_'.$status, 'TeacherAccount', $account->publicId);

        return ApiResponse::success($account->fresh(), $message);
    }

    private function availableUsername(Teacher $teacher): string
    {
        foreach ([$teacher->nip, $teacher->nuptk, $teacher->employeeNumber] as $value) {
            $username = strtolower(trim((string) $value));
            if ($username !== '' && ! TeacherAccount::query()->where('username', $username)->exists()) {
                return $username;
            }
        }abort(409, 'NIP, NUPTK, atau nomor pegawai belum tersedia atau sudah digunakan.');
    }

    private function mail(TeacherAccount $account, string $url): string
    {
        $to = $account->email ?? $account->teacher->email;
        if (! $to) {
            return 'NO_EMAIL';
        }try {
            Mail::to($to)->send(new TeacherActivationMail($account->load('teacher'), $url));

            return 'SENT';
        } catch (\Throwable $error) {
            report($error);

            return 'FAILED';
        }
    }
}

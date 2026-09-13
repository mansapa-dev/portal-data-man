<?php

namespace App\Http\Controllers;

use App\Mail\TeacherActivationMail;
use App\Models\Employee;
use App\Models\TeacherAccount;
use App\Models\TeacherPasswordSetupToken;
use App\Services\AuditService;
use App\Services\PortalSessionService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class EmployeeAccountController extends Controller
{
    public function __construct(private readonly AuditService $audit, private readonly PortalSessionService $sessions) {}

    public function show(Employee $employee): JsonResponse
    {
        return ApiResponse::success($employee->account, 'Akun pegawai berhasil diambil.');
    }

    public function store(Request $request, Employee $employee): JsonResponse
    {
        abort_if($employee->status !== 'ACTIVE', 409, 'Akun hanya dapat dibuat untuk pegawai aktif.');
        abort_if($employee->account()->exists(), 409, 'Pegawai sudah memiliki akun.');
        $email = $request->validate(['email' => ['nullable', 'email', 'max:191', 'unique:TeacherAccount,email']])['email'] ?? null;
        $username = $this->availableUsername($employee);
        $defaultPassword = 'Pegawai#'.Str::upper(Str::random(8)).random_int(10, 99);
        $raw = Str::random(64);
        $account = DB::transaction(function () use ($request, $employee, $email, $username, $defaultPassword, $raw) {
            $account = $employee->account()->create(['publicId' => (string) Str::ulid(), 'username' => $username, 'email' => $email ? strtolower($email) : null, 'passwordHash' => Hash::make($defaultPassword), 'initialPassword' => $defaultPassword, 'status' => 'ACTIVE', 'mustChangePassword' => true, 'activatedAt' => now()]);
            TeacherPasswordSetupToken::query()->create(['publicId' => (string) Str::ulid(), 'teacherAccountId' => $account->id, 'tokenHash' => hash('sha256', $raw), 'expiresAt' => now()->addDay()]);
            $this->audit->write($request, 'EMPLOYEE_ACCOUNT_PROVISIONED', 'TeacherAccount', $account->publicId, null, ['employeePublicId' => $employee->publicId, 'username' => $username, 'email' => $email]);

            return $account;
        });
        $setupUrl = url('/employee/setup-password?token='.urlencode($raw));

        return ApiResponse::success(['account' => $account, 'defaultPassword' => $defaultPassword, 'passwordSetupUrl' => $setupUrl, 'mailStatus' => $this->mail($account, $setupUrl)], 'Akun pegawai aktif dengan password awal dan tautan aktivasi berhasil dibuat.', 201);
    }

    public function regenerate(Request $request, Employee $employee): JsonResponse
    {
        $account = $employee->account;
        abort_unless($account, 404, 'Akun pegawai belum tersedia.');
        abort_unless($account->mustChangePassword, 409, 'Tautan aktivasi hanya tersedia selama password awal belum diganti.');
        $raw = Str::random(64);
        DB::transaction(function () use ($request, $account, $raw): void {
            TeacherPasswordSetupToken::query()->where('teacherAccountId', $account->id)->whereNull('usedAt')->update(['usedAt' => now()]);
            TeacherPasswordSetupToken::query()->create(['publicId' => (string) Str::ulid(), 'teacherAccountId' => $account->id, 'tokenHash' => hash('sha256', $raw), 'expiresAt' => now()->addDay()]);
            $this->audit->write($request, 'EMPLOYEE_SETUP_TOKEN_REGENERATED', 'TeacherAccount', $account->publicId);
        });
        $setupUrl = url('/employee/setup-password?token='.urlencode($raw));

        return ApiResponse::success(['passwordSetupUrl' => $setupUrl, 'mailStatus' => $this->mail($account, $setupUrl)], 'Token setup pegawai berhasil dibuat ulang.');
    }

    public function disable(Request $request, Employee $employee): JsonResponse
    {
        return $this->status($request, $employee, 'DISABLED', 'Akun pegawai dinonaktifkan.');
    }

    public function unlock(Request $request, Employee $employee): JsonResponse
    {
        return $this->status($request, $employee, 'ACTIVE', 'Kunci akun pegawai dibuka.', true);
    }

    public function enable(Request $request, Employee $employee): JsonResponse
    {
        abort_unless($employee->status === 'ACTIVE' && $employee->account?->passwordHash, 409, 'Pegawai harus aktif dan password sudah diatur.');

        return $this->status($request, $employee, 'ACTIVE', 'Akun pegawai diaktifkan.', true);
    }

    public function revokeSessions(Request $request, Employee $employee): JsonResponse
    {
        abort_unless($employee->account, 404, 'Akun pegawai belum tersedia.');
        $count = $this->sessions->revokeTeacher($employee->account);
        $this->audit->write($request, 'EMPLOYEE_SESSIONS_REVOKED', 'TeacherAccount', $employee->account->publicId, null, ['count' => $count]);

        return ApiResponse::success(null, 'Seluruh session pegawai berhasil dicabut.');
    }

    private function status(Request $request, Employee $employee, string $status, string $message, bool $reset = false): JsonResponse
    {
        $account = $employee->account;
        abort_unless($account, 404, 'Akun pegawai belum tersedia.');
        $account->forceFill(['status' => $status, 'disabledAt' => $status === 'DISABLED' ? now() : null, ...($reset ? ['failedLoginAttempts' => 0, 'lockedUntil' => null] : [])])->save();
        if ($status === 'DISABLED') {
            $this->sessions->revokeTeacher($account);
        }
        $this->audit->write($request, 'EMPLOYEE_ACCOUNT_'.$status, 'TeacherAccount', $account->publicId);

        return ApiResponse::success($account->fresh(), $message);
    }

    private function availableUsername(Employee $employee): string
    {
        foreach ([$employee->nip, $employee->nuptk] as $value) {
            $username = strtolower(trim((string) $value));
            if ($username !== '' && ! TeacherAccount::query()->where('username', $username)->exists()) {
                return $username;
            }
        }
        abort(409, 'NIP atau NUPTK belum tersedia atau sudah digunakan akun lain.');
    }

    private function mail(TeacherAccount $account, string $url): string
    {
        if (! $account->email) {
            return 'NO_EMAIL';
        }
        try {
            Mail::to($account->email)->send(new TeacherActivationMail($account->load(['teacher', 'employee']), $url));

            return 'SENT';
        } catch (\Throwable $error) {
            report($error);

            return 'FAILED';
        }
    }
}

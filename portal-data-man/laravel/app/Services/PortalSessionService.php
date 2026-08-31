<?php

namespace App\Services;

use App\Models\AdminUser;
use App\Models\AuthSession;
use App\Models\TeacherAccount;
use Illuminate\Http\Request;

class PortalSessionService
{
    public function register(Request $request, AdminUser|TeacherAccount $account): AuthSession
    {
        $this->revokeCurrent($request);
        $session = AuthSession::query()->create([
            'adminUserId' => $account instanceof AdminUser ? $account->id : null,
            'teacherAccountId' => $account instanceof TeacherAccount ? $account->id : null,
            'secretHash' => hash('sha256', $request->session()->getId()),
            'csrfHash' => hash('sha256', $request->session()->token()),
            'ipAddress' => $request->ip(),
            'userAgent' => mb_substr((string) $request->userAgent(), 0, 500),
            'lastUsedAt' => now(),
            'expiresAt' => now()->addMinutes((int) config('session.lifetime')),
        ]);
        $request->session()->put('portal_session_public_id', $session->publicId);

        return $session;
    }

    public function current(Request $request): ?AuthSession
    {
        $publicId = $request->session()->get('portal_session_public_id');
        if (! is_string($publicId)) {
            return null;
        }

        return AuthSession::query()->where('publicId', $publicId)->whereNull('revokedAt')->where('expiresAt', '>', now())->first();
    }

    public function touch(Request $request, AdminUser|TeacherAccount|null $account = null): bool
    {
        $session = $this->current($request);
        if (! $session) {
            return false;
        }
        if ($account instanceof AdminUser && (int) $session->adminUserId !== (int) $account->id) {
            return false;
        }
        if ($account instanceof TeacherAccount && (int) $session->teacherAccountId !== (int) $account->id) {
            return false;
        }
        $session->forceFill(['lastUsedAt' => now(), 'expiresAt' => now()->addMinutes((int) config('session.lifetime'))])->save();

        return true;
    }

    public function revokeCurrent(Request $request): void
    {
        $publicId = $request->session()->get('portal_session_public_id');
        if (is_string($publicId)) {
            AuthSession::query()->where('publicId', $publicId)->whereNull('revokedAt')->update(['revokedAt' => now()]);
        }
    }

    public function revokeAdmin(AdminUser $admin, ?string $except = null): int
    {
        return $admin->sessions()->whereNull('revokedAt')->when($except, fn ($query) => $query->where('publicId', '!=', $except))->update(['revokedAt' => now()]);
    }

    public function revokeTeacher(TeacherAccount $account, ?string $except = null): int
    {
        return $account->sessions()->whereNull('revokedAt')->when($except, fn ($query) => $query->where('publicId', '!=', $except))->update(['revokedAt' => now()]);
    }

    public function safeList(AdminUser|TeacherAccount $account, Request $request): array
    {
        $current = $request->session()->get('portal_session_public_id');
        $relation = $account instanceof AdminUser ? $account->sessions() : $account->sessions();

        return $relation->whereNull('revokedAt')->where('expiresAt', '>', now())->latest('lastUsedAt')->get()->map(fn (AuthSession $session) => [
            'publicId' => $session->publicId,
            'ipAddress' => $this->maskIp($session->ipAddress),
            'device' => mb_substr($session->userAgent ?: 'Perangkat tidak dikenal', 0, 80),
            'lastUsedAt' => $session->lastUsedAt,
            'createdAt' => $session->createdAt,
            'expiresAt' => $session->expiresAt,
            'current' => $session->publicId === $current,
        ])->all();
    }

    private function maskIp(?string $ip): ?string
    {
        if (! $ip) {
            return null;
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return preg_replace('/\.\d+$/', '.***', $ip);
        }

        return preg_replace('/:[^:]+$/', ':****', $ip);
    }
}

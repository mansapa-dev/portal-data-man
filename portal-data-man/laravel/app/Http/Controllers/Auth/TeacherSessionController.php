<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\TeacherAccount;
use App\Services\PortalSessionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class TeacherSessionController extends Controller
{
    public function __construct(private readonly PortalSessionService $sessions) {}

    public function store(Request $request): JsonResponse
    {
        $credentials = $request->validate(['username' => ['required', 'string'], 'password' => ['required', 'string']]);
        $input = trim($credentials['username']);
        $account = TeacherAccount::query()->with('teacher')
            ->where('username', strtolower($input))
            ->orWhere('username', $input)
            ->orWhereHas('teacher', fn ($q) => $q->where('nip', $input)->orWhere('email', strtolower($input)))
            ->first();

        if ($account?->status === 'LOCKED' && $account->lockedUntil?->isPast()) {
            $account->forceFill(['status' => 'ACTIVE', 'failedLoginAttempts' => 0, 'lockedUntil' => null])->save();
        }

        if ($account && $account->lockedUntil && $account->lockedUntil->isFuture()) {
            $minutes = ceil(now()->diffInSeconds($account->lockedUntil) / 60);
            return response()->json(['success' => false, 'message' => "Akun terkunci karena 5x salah password. Coba lagi dalam {$minutes} menit."], 401);
        }

        if ($account && (! $account->passwordHash || $account->status === 'PENDING_SETUP')) {
            return response()->json(['success' => false, 'message' => 'Akun belum aktif atau belum mengatur password. Silakan gunakan link atur password.'], 401);
        }

        $valid = $account && $account->status === 'ACTIVE' && $account->teacher?->status === 'ACTIVE' && ! $account->teacher?->deletedAt && $account->passwordHash && password_verify($credentials['password'], $account->passwordHash);
        if (! $valid) {
            if ($account) {
                $attempts = $account->failedLoginAttempts + 1;
                $account->forceFill(['failedLoginAttempts' => $attempts, 'status' => $attempts >= 5 ? 'LOCKED' : $account->status, 'lockedUntil' => $attempts >= 5 ? now()->addMinutes(15) : $account->lockedUntil])->save();
                if ($attempts >= 5) {
                    return response()->json(['success' => false, 'message' => 'Akun terkunci karena 5x salah password. Coba lagi dalam 15 menit.'], 401);
                }
            }

            return response()->json(['success' => false, 'message' => 'Username atau password tidak valid.'], 401);
        }

        $account->forceFill(['failedLoginAttempts' => 0, 'lockedUntil' => null, 'lastLoginAt' => now()])->save();
        Auth::guard('teacher')->login($account);
        $request->session()->regenerate();
        $this->sessions->register($request, $account);

        return response()->json(['success' => true, 'message' => 'Login berhasil.', 'data' => ['publicId' => $account->publicId, 'username' => $account->username, 'fullName' => $account->teacher->fullName]])->cookie('portal_teacher_csrf', $request->session()->token(), config('session.lifetime'), '/', null, $request->isSecure(), false, false, 'lax');
    }

    public function show(Request $request): JsonResponse
    {
        $account = $request->user('teacher')->load('teacher');

        return response()->json(['success' => true, 'message' => 'Sesi guru aktif.', 'data' => ['publicId' => $account->publicId, 'username' => $account->username, 'fullName' => $account->teacher->fullName]]);
    }

    public function csrf(Request $request): JsonResponse
    {
        abort_unless($request->user('teacher'), 401);
        $request->session()->regenerateToken();
        $session = $this->sessions->current($request);
        if ($session) {
            $session->forceFill(['csrfHash' => hash('sha256', $request->session()->token())])->save();
        }

        return response()->json(['success' => true, 'message' => 'Token CSRF diperbarui.', 'data' => ['csrf' => $request->session()->token()]])
            ->cookie('portal_teacher_csrf', $request->session()->token(), config('session.lifetime'), '/', null, $request->isSecure(), false, false, 'lax');
    }

    public function destroy(Request $request): JsonResponse
    {
        $this->sessions->revokeCurrent($request);
        Auth::guard('teacher')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['success' => true, 'message' => 'Logout berhasil.', 'data' => null]);
    }
}

<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\AdminUser;
use App\Services\PortalSessionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AdminSessionController extends Controller
{
    public function __construct(private readonly PortalSessionService $sessions) {}

    public function store(Request $request): JsonResponse
    {
        $credentials = $request->validate(['email' => ['required', 'email'], 'password' => ['required', 'string']]);
        $user = AdminUser::query()->where('email', strtolower($credentials['email']))->first();
        if ($user?->status === 'LOCKED' && $user->lockedUntil?->isPast()) {
            $user->forceFill(['status' => 'ACTIVE', 'failedLoginAttempts' => 0, 'lockedUntil' => null])->save();
        }
        $valid = $user && $user->status === 'ACTIVE' && ! $user->deletedAt && (! $user->lockedUntil || $user->lockedUntil->isPast()) && password_verify($credentials['password'], $user->passwordHash);
        if (! $valid) {
            if ($user) {
                $attempts = $user->failedLoginAttempts + 1;
                $user->forceFill(['failedLoginAttempts' => $attempts, 'status' => $attempts >= 5 ? 'LOCKED' : $user->status, 'lockedUntil' => $attempts >= 5 ? now()->addMinutes(15) : $user->lockedUntil])->save();
            }

            return response()->json(['success' => false, 'message' => 'Email atau password tidak valid.'], 401);
        }
        $user->forceFill(['failedLoginAttempts' => 0, 'lockedUntil' => null, 'lastLoginAt' => now()])->save();
        Auth::guard('admin')->login($user);
        $request->session()->regenerate();
        $this->sessions->register($request, $user);

        return response()->json(['success' => true, 'message' => 'Login berhasil.', 'data' => $user])->cookie('portal_csrf', $request->session()->token(), config('session.lifetime'), '/', null, $request->isSecure(), false, false, 'lax');
    }

    public function show(Request $request): JsonResponse
    {
        return response()->json(['success' => true, 'message' => 'Sesi admin aktif.', 'data' => $request->user('admin')]);
    }

    public function csrf(Request $request): JsonResponse
    {
        abort_unless($request->user('admin'), 401);
        $request->session()->regenerateToken();
        $session = $this->sessions->current($request);
        if ($session) {
            $session->forceFill(['csrfHash' => hash('sha256', $request->session()->token())])->save();
        }

        return response()->json(['success' => true, 'message' => 'Token CSRF diperbarui.', 'data' => ['csrf' => $request->session()->token()]]);
    }

    public function destroy(Request $request): JsonResponse
    {
        $this->sessions->revokeCurrent($request);
        Auth::guard('admin')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['success' => true, 'message' => 'Logout berhasil.', 'data' => null]);
    }
}

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
        $account = TeacherAccount::query()->with('teacher')->where('username', strtolower(trim($credentials['username'])))->first();
        if ($account?->status === 'LOCKED' && $account->lockedUntil?->isPast()) {
            $account->forceFill(['status' => 'ACTIVE', 'failedLoginAttempts' => 0, 'lockedUntil' => null])->save();
        }
        $valid = $account && $account->status === 'ACTIVE' && $account->teacher?->status === 'ACTIVE' && ! $account->teacher?->deletedAt && $account->passwordHash && (! $account->lockedUntil || $account->lockedUntil->isPast()) && password_verify($credentials['password'], $account->passwordHash);
        if (! $valid) {
            if ($account) {
                $attempts = $account->failedLoginAttempts + 1;
                $account->forceFill(['failedLoginAttempts' => $attempts, 'status' => $attempts >= 5 ? 'LOCKED' : $account->status, 'lockedUntil' => $attempts >= 5 ? now()->addMinutes(15) : $account->lockedUntil])->save();
            }

            return response()->json(['success' => false, 'message' => 'Username atau password tidak valid.'], 401);
        }
        $account->forceFill(['failedLoginAttempts' => 0, 'lockedUntil' => null, 'lastLoginAt' => now()])->save();
        Auth::guard('teacher')->login($account);
        $request->session()->regenerate();
        $this->sessions->register($request, $account);

        return response()->json(['success' => true, 'message' => 'Login berhasil.', 'data' => ['publicId' => $account->publicId, 'username' => $account->username, 'fullName' => $account->teacher->fullName]]);
    }

    public function show(Request $request): JsonResponse
    {
        $account = $request->user('teacher')->load('teacher');

        return response()->json(['success' => true, 'message' => 'Sesi guru aktif.', 'data' => ['publicId' => $account->publicId, 'username' => $account->username, 'fullName' => $account->teacher->fullName]]);
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

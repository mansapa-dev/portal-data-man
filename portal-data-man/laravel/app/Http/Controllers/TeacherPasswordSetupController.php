<?php

namespace App\Http\Controllers;

use App\Models\TeacherPasswordSetupToken;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

class TeacherPasswordSetupController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $token = $this->token((string) $request->query('token'));

        return ApiResponse::success(['valid' => (bool) $token, 'account' => $token ? ['fullName' => $token->account->teacher->fullName, 'username' => $token->account->username] : null], 'Status token berhasil diperiksa.');
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string'], 'password' => ['required', 'confirmed', Password::min(10)->mixedCase()->numbers()]]);
        $token = $this->token($data['token']);
        abort_unless($token, 422, 'Token setup tidak valid atau kedaluwarsa.');
        DB::transaction(function () use ($token, $data) {
            $used = TeacherPasswordSetupToken::query()->whereKey($token->id)->whereNull('usedAt')->where('expiresAt', '>', now())->update(['usedAt' => now()]);
            abort_unless($used === 1, 409, 'Token setup sudah digunakan.');
            $token->account->forceFill(['passwordHash' => Hash::make($data['password']), 'status' => 'ACTIVE', 'mustChangePassword' => false, 'activatedAt' => now(), 'passwordChangedAt' => now(), 'disabledAt' => null])->save();
            TeacherPasswordSetupToken::query()->where('teacherAccountId', $token->teacherAccountId)->where('id', '!=', $token->id)->whereNull('usedAt')->update(['usedAt' => now()]);
        });

        return ApiResponse::success(['activated' => true], 'Password berhasil diatur. Silakan login.');
    }

    private function token(string $raw): ?TeacherPasswordSetupToken
    {
        if ($raw === '') {
            return null;
        }

return TeacherPasswordSetupToken::query()->with('account.teacher')->where('tokenHash', hash('sha256', $raw))->whereNull('usedAt')->where('expiresAt', '>', now())->whereHas('account', fn ($q) => $q->where('status','PENDING_SETUP'))->first();
    }
}

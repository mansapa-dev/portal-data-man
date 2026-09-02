<?php

namespace App\Http\Controllers;

use App\Models\ApplicationClient;
use App\Models\OidcPayload;
use App\Models\TeacherAccount;
use App\Models\TeacherApplicationAccess;
use App\Services\OidcTokenService;
use App\Services\PortalSessionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class OidcController extends Controller
{
    public function __construct(private readonly OidcTokenService $tokens, private readonly PortalSessionService $sessions) {}

    public function discovery(): JsonResponse
    {
        $issuer = config('oidc.issuer');

        return response()->json(['issuer' => $issuer, 'authorization_endpoint' => $issuer.'/authorize', 'token_endpoint' => $issuer.'/token', 'userinfo_endpoint' => $issuer.'/userinfo', 'jwks_uri' => $issuer.'/jwks', 'end_session_endpoint' => $issuer.'/logout', 'response_types_supported' => ['code'], 'grant_types_supported' => ['authorization_code', 'client_credentials'], 'subject_types_supported' => ['public'], 'id_token_signing_alg_values_supported' => ['RS256'], 'token_endpoint_auth_methods_supported' => ['none', 'client_secret_post', 'client_secret_basic'], 'code_challenge_methods_supported' => ['S256'], 'scopes_supported' => ['openid', 'profile', 'email', 'portal_role', 'portal_data.read'], 'claims_supported' => ['sub', 'name', 'preferred_username', 'email', 'email_verified', 'portal_teacher_id', 'portal_role', 'client_id']]);
    }

    public function jwks(): JsonResponse
    {
        return response()->json(['keys' => [$this->tokens->jwk()]])->header('Cache-Control', 'public, max-age=3600');
    }

    public function authorize(Request $request): RedirectResponse
    {
        $data = $request->validate(['client_id' => ['required', 'string'], 'redirect_uri' => ['required', 'url'], 'response_type' => ['required', 'in:code'], 'scope' => ['required', 'string'], 'state' => ['nullable', 'string', 'max:1024'], 'nonce' => ['nullable', 'string', 'max:1024'], 'code_challenge' => ['required', 'string', 'min:43', 'max:128'], 'code_challenge_method' => ['required', 'in:S256']]);
        $client = ApplicationClient::query()->where('clientId', $data['client_id'])->where('status', 'ACTIVE')->firstOrFail();
        abort_unless(in_array($data['redirect_uri'], $client->redirectUris ?? [], true), 400, 'redirect_uri tidak terdaftar.');
        $scopes = array_values(array_unique(array_filter(explode(' ', $data['scope']))));
        abort_unless(in_array('openid', $scopes, true) && array_diff($scopes, $client->allowedScopes ?? []) === [], 400, 'Scope OIDC tidak valid.');
        $account = Auth::guard('teacher')->user();
        if (! $account) {
            return redirect('/teacher/login?returnTo='.urlencode($request->getRequestUri()));
        }
        if (! $request->session()->has('portal_session_public_id')) {
            $this->sessions->register($request, $account);
        }
        abort_unless($this->sessions->touch($request, $account), 401, 'Session guru tidak valid.');
        $access = TeacherApplicationAccess::query()->where('teacherId', $account->teacherId)->where('applicationClientId', $client->id)->where('status', 'ACTIVE')->first();
        abort_unless($access, 403, 'Akun belum diberi akses ke aplikasi ini.');
        $raw = Str::random(80);
        OidcPayload::query()->create(['id' => hash('sha256', $raw), 'kind' => 'AuthorizationCode', 'payload' => ['clientId' => $client->clientId, 'accountPublicId' => $account->publicId, 'redirectUri' => $data['redirect_uri'], 'scope' => $scopes, 'nonce' => $data['nonce'] ?? null, 'codeChallenge' => $data['code_challenge'], 'role' => $access->role], 'expiresAt' => now()->addSeconds(config('oidc.authorization_code_ttl'))]);

        return redirect()->away($data['redirect_uri'].'?'.http_build_query(array_filter(['code' => $raw, 'state' => $data['state'] ?? null], fn ($value) => $value !== null)));
    }

    public function token(Request $request): JsonResponse
    {
        if ($request->input('grant_type') === 'client_credentials') {
            return $this->clientCredentialsToken($request);
        }

        $data = $request->validate(['grant_type' => ['required', 'in:authorization_code'], 'client_id' => ['required', 'string'], 'code' => ['required', 'string'], 'redirect_uri' => ['required', 'url'], 'code_verifier' => ['required', 'string', 'min:43', 'max:128']]);
        $code = OidcPayload::query()->whereKey(hash('sha256', $data['code']))->where('kind', 'AuthorizationCode')->whereNull('consumedAt')->where('expiresAt', '>', now())->first();
        if (! $code) {
            return $this->oauthError('invalid_grant', 'Authorization code tidak valid atau kedaluwarsa.');
        }
        $payload = $code->payload;
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $data['code_verifier'], true)), '+/', '-_'), '=');
        if (! hash_equals((string) $payload['clientId'], $data['client_id']) || ! hash_equals((string) $payload['redirectUri'], $data['redirect_uri']) || ! hash_equals((string) $payload['codeChallenge'], $challenge)) {
            return $this->oauthError('invalid_grant', 'Validasi PKCE atau client gagal.');
        }
        $claimed = OidcPayload::query()->whereKey($code->id)->whereNull('consumedAt')->update(['consumedAt' => now()]);
        if ($claimed !== 1) {
            return $this->oauthError('invalid_grant', 'Authorization code sudah digunakan.');
        }
        $account = TeacherAccount::query()->with('teacher')->where('publicId', $payload['accountPublicId'])->where('status', 'ACTIVE')->first();
        if (! $account || $account->teacher->status !== 'ACTIVE') {
            return $this->oauthError('invalid_grant', 'Akun guru tidak aktif.');
        }
        $now = time();
        $expires = $now + config('oidc.access_token_ttl');
        $base = ['iss' => config('oidc.issuer'), 'sub' => $account->publicId, 'aud' => $data['client_id'], 'iat' => $now, 'exp' => $expires];
        $accessToken = $this->tokens->sign([...$base, 'jti' => (string) Str::uuid(), 'scope' => implode(' ', $payload['scope']), 'token_use' => 'access']);
        $idToken = $this->tokens->sign([...$base, 'nonce' => $payload['nonce'], ...$this->claims($account, $payload['role'])]);

        return response()->json(['access_token' => $accessToken, 'token_type' => 'Bearer', 'expires_in' => config('oidc.access_token_ttl'), 'scope' => implode(' ', $payload['scope']), 'id_token' => $idToken])->header('Cache-Control', 'no-store')->header('Pragma', 'no-cache');
    }

    private function clientCredentialsToken(Request $request): JsonResponse
    {
        $basicUser = $request->getUser();
        $basicSecret = $request->getPassword();
        $data = $request->validate([
            'grant_type' => ['required', 'in:client_credentials'],
            'client_id' => [$basicUser ? 'nullable' : 'required', 'nullable', 'string'],
            'client_secret' => [$basicSecret ? 'nullable' : 'required', 'nullable', 'string'],
            'scope' => ['nullable', 'string'],
        ]);
        $clientId = (string) ($basicUser ?: ($data['client_id'] ?? ''));
        $secret = (string) ($basicSecret ?: ($data['client_secret'] ?? ''));
        $client = ApplicationClient::query()->where('clientId', $clientId)->where('clientType', 'SERVICE')->where('status', 'ACTIVE')->first();
        if (! $client || ! $client->clientSecretHash || ! password_verify($secret, $client->clientSecretHash) || ! in_array('client_credentials', $client->allowedGrantTypes ?? [], true)) {
            return response()->json(['error' => 'invalid_client', 'error_description' => 'Kredensial aplikasi tidak valid.'], 401)
                ->header('WWW-Authenticate', 'Basic realm="Portal Data OIDC"')->header('Cache-Control', 'no-store');
        }
        $requested = array_values(array_unique(array_filter(explode(' ', trim((string) ($data['scope'] ?? 'portal_data.read'))))));
        if (! $requested || array_diff($requested, $client->allowedScopes ?? [])) {
            return $this->oauthError('invalid_scope', 'Scope aplikasi tidak diizinkan.');
        }
        $now = time();
        $ttl = max(60, min((int) $client->accessTokenLifetime, 3600));
        $accessToken = $this->tokens->sign([
            'iss' => config('oidc.issuer'), 'sub' => $client->clientId, 'aud' => $client->clientId,
            'client_id' => $client->clientId, 'iat' => $now, 'exp' => $now + $ttl,
            'jti' => (string) Str::uuid(), 'scope' => implode(' ', $requested),
            'token_use' => 'access', 'grant_type' => 'client_credentials',
        ]);

        return response()->json(['access_token' => $accessToken, 'token_type' => 'Bearer', 'expires_in' => $ttl, 'scope' => implode(' ', $requested)])
            ->header('Cache-Control', 'no-store')->header('Pragma', 'no-cache');
    }

    public function userinfo(Request $request): JsonResponse
    {
        $header = $request->bearerToken();
        $claims = $header ? $this->tokens->verify($header) : null;
        if (! $claims || ($claims['token_use'] ?? null) !== 'access') {
            return response()->json(['error' => 'invalid_token'], 401)->header('WWW-Authenticate', 'Bearer error="invalid_token"');
        }
        $account = TeacherAccount::query()->with('teacher')->where('publicId', $claims['sub'])->where('status', 'ACTIVE')->first();
        $access = $account ? TeacherApplicationAccess::query()->where('teacherId', $account->teacherId)->whereHas('application', fn ($query) => $query->where('clientId', $claims['aud'])->where('status', 'ACTIVE'))->where('status', 'ACTIVE')->first() : null;
        if (! $account || ! $access) {
            return response()->json(['error' => 'invalid_token'], 401);
        }

        return response()->json($this->claims($account, $access->role))->header('Cache-Control', 'no-store');
    }

    public function logout(Request $request): RedirectResponse
    {
        Auth::guard('teacher')->logout();
        $this->sessions->revokeCurrent($request);
        $request->session()->invalidate();
        $uri = (string) $request->query('post_logout_redirect_uri', '/teacher/login');
        if ($uri !== '/teacher/login') {
            $valid = ApplicationClient::query()->where('status', 'ACTIVE')->get()->contains(fn ($client) => in_array($uri, $client->postLogoutRedirectUris ?? [], true));
            abort_unless($valid, 400, 'post_logout_redirect_uri tidak terdaftar.');
        }
        $state = $request->query('state');

        return redirect()->away($uri.($state ? (str_contains($uri, '?') ? '&' : '?').'state='.urlencode((string) $state) : ''));
    }

    private function claims(TeacherAccount $account, string $role): array
    {
        $email = $account->email ?? $account->teacher->email;

        return ['sub' => $account->publicId, 'name' => $account->teacher->fullName, 'preferred_username' => $account->username, 'email' => $email, 'email_verified' => (bool) $email, 'portal_teacher_id' => $account->teacher->publicId, 'portal_role' => $role];
    }

    private function oauthError(string $error, string $description): JsonResponse
    {
        return response()->json(['error' => $error, 'error_description' => $description], 400)->header('Cache-Control', 'no-store');
    }
}

<?php

namespace App\Http\Controllers;

use App\Models\ApplicationClient;
use App\Models\Teacher;
use App\Models\TeacherApplicationAccess;
use App\Services\AuditService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class SsoApplicationController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(): JsonResponse
    {
        $apps = ApplicationClient::query()->withCount('access')->orderBy('name')->get();
        $apps->each(fn (ApplicationClient $app) => $app->setAttribute('_count', ['access' => (int) $app->access_count]));
        return ApiResponse::success($apps, 'Aplikasi SSO berhasil diambil.');
    }

    public function show(ApplicationClient $applicationClient): JsonResponse
    {
        return ApiResponse::success($applicationClient->load(['access.teacher']), 'Aplikasi SSO berhasil diambil.');
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $service = $data['applicationType'] === 'SERVICE';
        $secret = $service ? $this->secret() : null;
        $client = ApplicationClient::query()->create(['name' => trim($data['name']), 'slug' => $data['slug'], 'description' => $data['description'] ?? null, 'clientId' => 'portal_'.$data['slug'].'_'.Str::lower(Str::random(16)), 'clientSecretHash' => $secret ? password_hash($secret, PASSWORD_DEFAULT) : null, 'clientType' => $service ? 'SERVICE' : 'PUBLIC_WEB', 'status' => 'ACTIVE', 'redirectUris' => $service ? [] : $this->uris($data['redirectUris']), 'postLogoutRedirectUris' => $service ? [] : $this->uris($data['postLogoutRedirectUris'] ?? []), 'allowedOrigins' => [], 'allowedScopes' => $service ? ['portal_data.read'] : ['openid', 'profile', 'email', 'portal_role'], 'allowedGrantTypes' => [$service ? 'client_credentials' : 'authorization_code']]);
        $this->audit->write($request, 'SSO_APPLICATION_CREATED', 'ApplicationClient', $client->publicId, null, ['name' => $client->name, 'clientId' => $client->clientId]);

        if ($secret) {
            $client->setAttribute('clientSecret', $secret);
        }

        return ApiResponse::success($client, 'Aplikasi SSO berhasil dibuat.', 201);
    }

    public function update(Request $request, ApplicationClient $applicationClient): JsonResponse
    {
        $data = $this->validated($request, true, $applicationClient);
        unset($data['applicationType']);
        $old = $applicationClient->replicate();
        foreach (['redirectUris', 'postLogoutRedirectUris'] as $field) {
            if (array_key_exists($field, $data)) {
                $data[$field] = $this->uris($data[$field] ?? []);
            }
        }
        $applicationClient->update($data);
        $this->audit->write($request, 'SSO_APPLICATION_UPDATED', 'ApplicationClient', $applicationClient->publicId, $old, $applicationClient);

        return ApiResponse::success($applicationClient->fresh(), 'Aplikasi SSO berhasil diperbarui.');
    }

    public function grant(Request $request, ApplicationClient $applicationClient): JsonResponse
    {
        abort_if($applicationClient->clientType === 'SERVICE', 422, 'Aplikasi service tidak menggunakan akses guru.');
        $data = $request->validate(['teacherPublicId' => ['required', 'string', 'size:26'], 'role' => ['required', 'regex:/^[A-Za-z0-9:_-]+$/', 'max:100']]);
        $teacher = Teacher::query()->where('publicId', $data['teacherPublicId'])->where('status', 'ACTIVE')->firstOrFail();
        TeacherApplicationAccess::query()->updateOrCreate(['teacherId' => $teacher->id, 'applicationClientId' => $applicationClient->id], ['role' => $data['role'], 'status' => 'ACTIVE', 'grantedAt' => now(), 'grantedBy' => $request->user('admin')->publicId]);
        $this->audit->write($request, 'SSO_ACCESS_GRANTED', 'ApplicationClient', $applicationClient->publicId, null, ['teacherPublicId' => $teacher->publicId, 'role' => $data['role']]);

        return $this->show($applicationClient);
    }

    public function revoke(Request $request, ApplicationClient $applicationClient, string $teacherPublicId): JsonResponse
    {
        $teacher = Teacher::withTrashed()->where('publicId', $teacherPublicId)->firstOrFail();
        $count = TeacherApplicationAccess::query()->where('applicationClientId', $applicationClient->id)->where('teacherId', $teacher->id)->update(['status' => 'INACTIVE']);
        abort_unless($count, 404, 'Akses tidak ditemukan.');
        $this->audit->write($request, 'SSO_ACCESS_REVOKED', 'ApplicationClient', $applicationClient->publicId, null, ['teacherPublicId' => $teacherPublicId]);

        return ApiResponse::success(null, 'Akses guru berhasil dicabut.');
    }

    public function rotateSecret(Request $request, ApplicationClient $applicationClient): JsonResponse
    {
        abort_unless($applicationClient->clientType === 'SERVICE', 422, 'Client secret hanya tersedia untuk aplikasi service.');
        $secret = $this->secret();
        $applicationClient->update(['clientSecretHash' => password_hash($secret, PASSWORD_DEFAULT)]);
        $this->audit->write($request, 'SSO_CLIENT_SECRET_ROTATED', 'ApplicationClient', $applicationClient->publicId, null, ['clientId' => $applicationClient->clientId]);

        return ApiResponse::success(['clientId' => $applicationClient->clientId, 'clientSecret' => $secret], 'Client secret baru dibuat. Secret lama langsung tidak berlaku.');
    }

    private function validated(Request $request, bool $partial = false, ?ApplicationClient $client = null): array
    {
        $required = $partial ? 'sometimes' : 'required';

        $service = $request->input('applicationType') === 'SERVICE' || $client?->clientType === 'SERVICE';

        return $request->validate(['name' => [$required, 'string', 'min:2', 'max:150'], 'slug' => [$required, 'regex:/^[a-z0-9-]+$/', 'max:100', Rule::unique('ApplicationClient', 'slug')->ignore($client?->id)], 'applicationType' => [$partial ? 'sometimes' : 'required', Rule::in(['SSO', 'SERVICE'])], 'description' => ['sometimes', 'nullable', 'string'], 'redirectUris' => [$service ? 'sometimes' : $required, 'array', $service ? 'max:0' : 'min:1'], 'redirectUris.*' => ['url', 'max:2000'], 'postLogoutRedirectUris' => ['sometimes', 'array'], 'postLogoutRedirectUris.*' => ['url', 'max:2000'], 'status' => ['sometimes', Rule::in(['ACTIVE', 'INACTIVE'])]]);
    }

    private function uris(array $values): array
    {
        $values = array_values(array_unique($values));
        foreach ($values as $value) {
            $parts = parse_url($value);
            abort_if(isset($parts['fragment']), 422, 'Redirect URI tidak boleh memiliki fragment.');
            $local = in_array($parts['host'] ?? null, ['localhost', '127.0.0.1'], true);
            abort_unless(($parts['scheme'] ?? null) === 'https' || $local, 422, 'Redirect URI non-local wajib menggunakan HTTPS.');
        }

        return $values;
    }

    private function secret(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
    }
}

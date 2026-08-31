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
        $client = ApplicationClient::query()->create(['name' => trim($data['name']), 'slug' => $data['slug'], 'description' => $data['description'] ?? null, 'clientId' => 'portal_'.$data['slug'].'_'.Str::lower(Str::random(16)), 'clientType' => 'PUBLIC_WEB', 'status' => 'ACTIVE', 'redirectUris' => $this->uris($data['redirectUris']), 'postLogoutRedirectUris' => $this->uris($data['postLogoutRedirectUris'] ?? []), 'allowedOrigins' => [], 'allowedScopes' => ['openid', 'profile', 'email', 'portal_role'], 'allowedGrantTypes' => ['authorization_code']]);
        $this->audit->write($request, 'SSO_APPLICATION_CREATED', 'ApplicationClient', $client->publicId, null, ['name' => $client->name, 'clientId' => $client->clientId]);

        return ApiResponse::success($client, 'Aplikasi SSO berhasil dibuat.', 201);
    }

    public function update(Request $request, ApplicationClient $applicationClient): JsonResponse
    {
        $data = $this->validated($request, true, $applicationClient);
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
        $data = $request->validate(['teacherPublicId' => ['required', 'string', 'size:26'], 'role' => ['required', 'regex:/^[A-Za-z0-9:_-]+$/', 'max:100']]);
        $teacher = Teacher::query()->where('publicId', $data['teacherPublicId'])->where('status', 'ACTIVE')->firstOrFail();
        TeacherApplicationAccess::query()->updateOrCreate(['teacherId' => $teacher->id, 'applicationClientId' => $applicationClient->id], ['role' => $data['role'], 'status' => 'ACTIVE', 'grantedAt' => now(), 'grantedBy' => $request->user('admin')->publicId]);
        $this->audit->write($request, 'SSO_ACCESS_GRANTED', 'ApplicationClient', $applicationClient->publicId, null, ['teacherPublicId' => $teacher->publicId, 'role' => $data['role']]);

        return $this->show($applicationClient);
    }

    public function revoke(Request $request, ApplicationClient $applicationClient, string $teacherPublicId): JsonResponse
    {
        $teacher = Teacher::query()->where('publicId', $teacherPublicId)->firstOrFail();
        $count = TeacherApplicationAccess::query()->where('applicationClientId', $applicationClient->id)->where('teacherId', $teacher->id)->update(['status' => 'INACTIVE']);
        abort_unless($count, 404, 'Akses tidak ditemukan.');
        $this->audit->write($request, 'SSO_ACCESS_REVOKED', 'ApplicationClient', $applicationClient->publicId, null, ['teacherPublicId' => $teacherPublicId]);

        return ApiResponse::success(null, 'Akses guru berhasil dicabut.');
    }

    private function validated(Request $request, bool $partial = false, ?ApplicationClient $client = null): array
    {
        $required = $partial ? 'sometimes' : 'required';

        return $request->validate(['name' => [$required, 'string', 'min:2', 'max:150'], 'slug' => [$required, 'regex:/^[a-z0-9-]+$/', 'max:100', Rule::unique('ApplicationClient', 'slug')->ignore($client?->id)], 'description' => ['sometimes', 'nullable', 'string'], 'redirectUris' => [$required, 'array', 'min:1'], 'redirectUris.*' => ['url', 'max:2000'], 'postLogoutRedirectUris' => ['sometimes', 'array'], 'postLogoutRedirectUris.*' => ['url', 'max:2000'], 'status' => ['sometimes', Rule::in(['ACTIVE', 'INACTIVE'])]]);
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
}

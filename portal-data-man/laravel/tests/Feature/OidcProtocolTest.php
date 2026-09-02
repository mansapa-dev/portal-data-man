<?php

namespace Tests\Feature;

use App\Models\ApplicationClient;
use App\Models\Teacher;
use App\Models\TeacherAccount;
use App\Models\TeacherApplicationAccess;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class OidcProtocolTest extends TestCase
{
    private string $privateKey;

    private string $publicKey;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createTables();
        $this->privateKey = sys_get_temp_dir().'/portal-oidc-test-private-'.uniqid().'.pem';
        $this->publicKey = sys_get_temp_dir().'/portal-oidc-test-public-'.uniqid().'.pem';
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        openssl_pkey_export($key, $private);
        $details = openssl_pkey_get_details($key);
        file_put_contents($this->privateKey, $private);
        file_put_contents($this->publicKey, $details['key']);
        config(['oidc.private_key_path' => $this->privateKey, 'oidc.public_key_path' => $this->publicKey, 'oidc.issuer' => 'http://localhost/oidc']);
    }

    protected function tearDown(): void
    {
        @unlink($this->privateKey);
        @unlink($this->publicKey);
        foreach (['OidcPayload', 'TeacherApplicationAccess', 'ApplicationClient', 'AuthSession', 'TeacherAccount', 'Teacher'] as $table) {
            Schema::dropIfExists($table);
        }
        parent::tearDown();
    }

    public function test_authorization_code_pkce_flow_and_replay_protection(): void
    {
        $teacher = Teacher::query()->create(['nip' => '19870001', 'fullName' => 'Guru OIDC', 'email' => 'guru@example.test', 'status' => 'ACTIVE']);
        $account = TeacherAccount::query()->create(['teacherId' => $teacher->id, 'username' => '19870001', 'email' => 'guru@example.test', 'passwordHash' => password_hash('Password123', PASSWORD_ARGON2ID), 'status' => 'ACTIVE']);
        $client = ApplicationClient::query()->create(['name' => 'Jurnal Kelas', 'slug' => 'jurnal-kelas', 'clientId' => 'portal_jurnal_test', 'clientType' => 'PUBLIC_WEB', 'status' => 'ACTIVE', 'redirectUris' => ['https://jurnal.example.test/callback'], 'postLogoutRedirectUris' => ['https://jurnal.example.test/logout'], 'allowedOrigins' => [], 'allowedScopes' => ['openid', 'profile', 'email', 'portal_role'], 'allowedGrantTypes' => ['authorization_code']]);
        TeacherApplicationAccess::query()->create(['teacherId' => $teacher->id, 'applicationClientId' => $client->id, 'role' => 'TEACHER', 'status' => 'ACTIVE', 'grantedBy' => '01ADMIN00000000000000000']);
        $verifier = str_repeat('a', 64);
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $query = http_build_query(['client_id' => $client->clientId, 'redirect_uri' => 'https://jurnal.example.test/callback', 'response_type' => 'code', 'scope' => 'openid profile email portal_role', 'state' => 'state-123', 'nonce' => 'nonce-123', 'code_challenge' => $challenge, 'code_challenge_method' => 'S256']);
        $redirect = $this->actingAs($account, 'teacher')->get('/oidc/authorize?'.$query)->assertRedirect();
        parse_str((string) parse_url($redirect->headers->get('Location'), PHP_URL_QUERY), $params);
        $this->assertSame('state-123', $params['state']);

        $payload = ['grant_type' => 'authorization_code', 'client_id' => $client->clientId, 'code' => $params['code'], 'redirect_uri' => 'https://jurnal.example.test/callback', 'code_verifier' => $verifier];
        $token = $this->postJson('/oidc/token', $payload)->assertOk()->assertJsonPath('token_type', 'Bearer')->assertJsonStructure(['access_token', 'id_token', 'expires_in'])->json();
        $this->withToken($token['access_token'])->getJson('/oidc/userinfo')->assertOk()->assertJsonPath('portal_teacher_id', $teacher->publicId)->assertJsonPath('portal_role', 'TEACHER')->assertJsonPath('preferred_username', '19870001');
        $this->postJson('/oidc/token', $payload)->assertStatus(400)->assertJsonPath('error', 'invalid_grant');
    }

    public function test_redirect_uri_must_match_registered_uri_exactly(): void
    {
        $teacher = Teacher::query()->create(['nip' => '19870002', 'fullName' => 'Guru', 'status' => 'ACTIVE']);
        $account = TeacherAccount::query()->create(['teacherId' => $teacher->id, 'username' => '19870002', 'passwordHash' => 'hash', 'status' => 'ACTIVE']);
        ApplicationClient::query()->create(['name' => 'App', 'slug' => 'app', 'clientId' => 'client', 'clientType' => 'PUBLIC_WEB', 'status' => 'ACTIVE', 'redirectUris' => ['https://app.example.test/callback'], 'allowedOrigins' => [], 'allowedScopes' => ['openid'], 'allowedGrantTypes' => ['authorization_code']]);
        $query = http_build_query(['client_id' => 'client', 'redirect_uri' => 'https://evil.example.test/callback', 'response_type' => 'code', 'scope' => 'openid', 'code_challenge' => str_repeat('a', 43), 'code_challenge_method' => 'S256']);
        $this->actingAs($account, 'teacher')->get('/oidc/authorize?'.$query)->assertStatus(400);
    }

    public function test_service_client_credentials_returns_scoped_access_token(): void
    {
        $secret = 'service-secret-for-test-2026';
        $client = ApplicationClient::query()->create([
            'name' => 'CBT Sync', 'slug' => 'cbt-sync', 'clientId' => 'portal_cbt_sync_test',
            'clientSecretHash' => password_hash($secret, PASSWORD_DEFAULT), 'clientType' => 'SERVICE',
            'status' => 'ACTIVE', 'redirectUris' => [], 'postLogoutRedirectUris' => [], 'allowedOrigins' => [],
            'allowedScopes' => ['portal_data.read'], 'allowedGrantTypes' => ['client_credentials'],
        ]);

        $response = $this->postJson('/oidc/token', [
            'grant_type' => 'client_credentials', 'client_id' => $client->clientId,
            'client_secret' => $secret, 'scope' => 'portal_data.read',
        ])->assertOk()->assertJsonPath('token_type', 'Bearer')->assertJsonPath('scope', 'portal_data.read');

        $this->assertNotEmpty($response->json('access_token'));
        $this->postJson('/oidc/token', ['grant_type' => 'client_credentials', 'client_id' => $client->clientId, 'client_secret' => 'wrong', 'scope' => 'portal_data.read'])->assertStatus(401)->assertJsonPath('error', 'invalid_client');
    }

    private function createTables(): void
    {
        Schema::create('Teacher', function (Blueprint $t) {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->string('nip')->nullable();
            $t->string('nuptk')->nullable();
            $t->string('employeeNumber')->nullable();
            $t->string('fullName');
            $t->string('gender')->nullable();
            $t->string('email')->nullable();
            $t->string('phone')->nullable();
            $t->text('address')->nullable();
            $t->string('photoPath')->nullable();
            $t->string('status');
            $t->dateTime('createdAt');
            $t->dateTime('updatedAt');
            $t->dateTime('deletedAt')->nullable();
        });
        Schema::create('TeacherAccount', function (Blueprint $t) {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->unsignedBigInteger('teacherId')->unique();
            $t->string('username')->unique();
            $t->string('email')->nullable();
            $t->string('passwordHash')->nullable();
            $t->string('status');
            $t->boolean('mustChangePassword')->default(false);
            $t->integer('failedLoginAttempts')->default(0);
            $t->dateTime('lockedUntil')->nullable();
            $t->dateTime('lastLoginAt')->nullable();
            $t->dateTime('passwordChangedAt')->nullable();
            $t->dateTime('activatedAt')->nullable();
            $t->dateTime('disabledAt')->nullable();
            $t->dateTime('createdAt');
            $t->dateTime('updatedAt');
        });
        Schema::create('AuthSession', function (Blueprint $t) {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->unsignedBigInteger('adminUserId')->nullable();
            $t->unsignedBigInteger('teacherAccountId')->nullable();
            $t->string('secretHash')->unique();
            $t->string('csrfHash');
            $t->string('ipAddress')->nullable();
            $t->string('userAgent')->nullable();
            $t->dateTime('lastUsedAt');
            $t->dateTime('expiresAt');
            $t->dateTime('revokedAt')->nullable();
            $t->dateTime('createdAt');
            $t->string('rotatedFrom')->nullable();
        });
        Schema::create('ApplicationClient', function (Blueprint $t) {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->string('name');
            $t->string('slug')->unique();
            $t->string('clientId')->unique();
            $t->string('clientSecretHash')->nullable();
            $t->string('clientType');
            $t->string('status');
            $t->json('redirectUris');
            $t->json('postLogoutRedirectUris')->nullable();
            $t->json('allowedOrigins')->nullable();
            $t->json('allowedScopes');
            $t->json('allowedGrantTypes');
            $t->string('logoPath')->nullable();
            $t->text('description')->nullable();
            $t->integer('accessTokenLifetime')->default(900);
            $t->integer('refreshTokenLifetime')->default(2592000);
            $t->dateTime('createdAt');
            $t->dateTime('updatedAt');
        });
        Schema::create('TeacherApplicationAccess', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('teacherId');
            $t->unsignedBigInteger('applicationClientId');
            $t->string('role');
            $t->string('status');
            $t->dateTime('grantedAt')->useCurrent();
            $t->string('grantedBy');
            $t->dateTime('createdAt');
            $t->dateTime('updatedAt');
            $t->unique(['teacherId', 'applicationClientId']);
        });
        Schema::create('OidcPayload', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('kind');
            $t->json('payload');
            $t->string('grantId')->nullable();
            $t->string('userCode')->nullable();
            $t->string('uid')->nullable();
            $t->dateTime('expiresAt');
            $t->dateTime('consumedAt')->nullable();
            $t->dateTime('createdAt');
        });
    }
}

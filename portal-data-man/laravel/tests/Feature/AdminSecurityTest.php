<?php

namespace Tests\Feature;

use App\Models\AdminUser;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AdminSecurityTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Schema::create('AdminUser', function (Blueprint $t) {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->string('name');
            $t->string('email')->unique();
            $t->string('passwordHash');
            $t->string('role');
            $t->string('status');
            $t->integer('failedLoginAttempts')->default(0);
            $t->dateTime('lockedUntil')->nullable();
            $t->dateTime('lastLoginAt')->nullable();
            $t->dateTime('passwordChangedAt')->nullable();
            $t->dateTime('createdAt');
            $t->dateTime('updatedAt');
            $t->dateTime('deletedAt')->nullable();
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
        Schema::create('AuditLog', function (Blueprint $t) {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->string('actorType');
            $t->string('actorPublicId')->nullable();
            $t->unsignedBigInteger('applicationClientId')->nullable();
            $t->string('action');
            $t->string('entityType')->nullable();
            $t->string('entityPublicId')->nullable();
            $t->json('oldValues')->nullable();
            $t->json('newValues')->nullable();
            $t->string('requestMethod')->nullable();
            $t->string('requestPath')->nullable();
            $t->string('ipAddress')->nullable();
            $t->string('userAgent')->nullable();
            $t->dateTime('createdAt');
        });
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('AuditLog');
        Schema::dropIfExists('AuthSession');
        Schema::dropIfExists('AdminUser');
        parent::tearDown();
    }

    public function test_login_registers_session_and_password_change_revokes_other_sessions(): void
    {
        $admin = AdminUser::query()->create(['name' => 'Admin', 'email' => 'admin@example.test', 'passwordHash' => Hash::make('PasswordLama123'), 'role' => 'SUPER_ADMIN', 'status' => 'ACTIVE']);
        $this->postJson('/api/v1/auth/admin/login', ['email' => $admin->email, 'password' => 'PasswordLama123'])->assertOk();
        $this->assertDatabaseCount('AuthSession', 1);
        $admin->sessions()->create(['secretHash' => hash('sha256', 'other'), 'csrfHash' => hash('sha256', 'csrf'), 'lastUsedAt' => now(), 'expiresAt' => now()->addHour()]);

        $this->postJson('/api/v1/profile/change-password', ['currentPassword' => 'PasswordLama123', 'newPassword' => 'PasswordBaru456', 'newPassword_confirmation' => 'PasswordBaru456'])->assertOk();
        $this->assertSame(1, $admin->sessions()->whereNull('revokedAt')->count());
        $this->assertTrue(Hash::check('PasswordBaru456', $admin->fresh()->passwordHash));
    }

    public function test_super_admin_cannot_disable_self_or_last_active_super_admin(): void
    {
        $admin = AdminUser::query()->create(['name' => 'Admin', 'email' => 'admin@example.test', 'passwordHash' => 'hash', 'role' => 'SUPER_ADMIN', 'status' => 'ACTIVE']);
        $this->actingAs($admin, 'admin')->postJson("/api/v1/admin-users/{$admin->publicId}/deactivate")->assertConflict();
        $second = AdminUser::query()->create(['name' => 'Admin Dua', 'email' => 'dua@example.test', 'passwordHash' => 'hash', 'role' => 'SUPER_ADMIN', 'status' => 'ACTIVE']);
        $this->actingAs($admin, 'admin')->postJson("/api/v1/admin-users/{$second->publicId}/deactivate")->assertOk();
        $this->assertDatabaseHas('AdminUser', ['publicId' => $second->publicId, 'status' => 'INACTIVE']);
    }
}

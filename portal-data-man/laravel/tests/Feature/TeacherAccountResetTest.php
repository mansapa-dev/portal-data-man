<?php

namespace Tests\Feature;

use App\Models\AdminUser;
use App\Models\Teacher;
use App\Models\TeacherAccount;
use App\Services\SpreadsheetExportService;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TeacherAccountResetTest extends TestCase
{
    private AdminUser $admin;
    private Teacher $teacher;
    private TeacherAccount $account;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();

        Schema::create('AdminUser', function (Blueprint $t) {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->string('name');
            $t->string('email')->unique();
            $t->string('passwordHash');
            $t->string('role');
            $t->string('status')->default('ACTIVE');
            $t->integer('failedLoginAttempts')->default(0);
            $t->dateTime('lockedUntil')->nullable();
            $t->dateTime('lastLoginAt')->nullable();
            $t->dateTime('passwordChangedAt')->nullable();
            $t->dateTime('createdAt');
            $t->dateTime('updatedAt');
        });

        Schema::create('Teacher', function (Blueprint $t) {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->string('nip')->nullable()->unique();
            $t->string('nuptk')->nullable()->unique();
            $t->string('employeeNumber')->nullable()->unique();
            $t->string('fullName');
            $t->string('gender')->nullable();
            $t->string('email')->nullable()->unique();
            $t->string('phone')->nullable();
            $t->text('address')->nullable();
            $t->string('photoPath')->nullable();
            $t->string('status')->default('ACTIVE');
            $t->dateTime('createdAt');
            $t->dateTime('updatedAt');
            $t->dateTime('deletedAt')->nullable();
        });

        Schema::create('TeacherAccount', function (Blueprint $t) {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->unsignedBigInteger('teacherId')->unique();
            $t->string('username')->unique();
            $t->string('email')->nullable()->unique();
            $t->string('passwordHash')->nullable();
            $t->text('initialPassword')->nullable();
            $t->string('status')->default('ACTIVE');
            $t->boolean('mustChangePassword')->default(true);
            $t->integer('failedLoginAttempts')->default(0);
            $t->dateTime('lockedUntil')->nullable();
            $t->dateTime('lastLoginAt')->nullable();
            $t->dateTime('passwordChangedAt')->nullable();
            $t->dateTime('activatedAt')->nullable();
            $t->dateTime('disabledAt')->nullable();
            $t->dateTime('createdAt');
            $t->dateTime('updatedAt');
        });

        Schema::create('TeacherPasswordSetupToken', function (Blueprint $t) {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->unsignedBigInteger('teacherAccountId');
            $t->string('tokenHash', 64)->unique();
            $t->dateTime('expiresAt');
            $t->dateTime('usedAt')->nullable();
            $t->dateTime('createdAt');
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

        $this->admin = AdminUser::create([
            'publicId' => '01ADMIN0000000000000000001',
            'name' => 'Admin SIPADU',
            'email' => 'admin@man1palembang.sch.id',
            'passwordHash' => Hash::make('AdminRahasia#123'),
            'role' => 'SUPER_ADMIN',
            'status' => 'ACTIVE',
        ]);

        $this->teacher = Teacher::create([
            'publicId' => '01GURUTESTRESET000000000001',
            'fullName' => 'Guru Peneliti Uji',
            'nip' => '198501012010011005',
            'status' => 'ACTIVE',
        ]);

        $this->account = $this->teacher->account()->create([
            'publicId' => '01ACC000000000000000000001',
            'username' => '198501012010011005',
            'passwordHash' => Hash::make('PasswordLama#123'),
            'initialPassword' => null, // Simulasi password yang sudah pernah diubah guru
            'status' => 'ACTIVE',
            'mustChangePassword' => false,
            'activatedAt' => now(),
        ]);
    }

    public function test_admin_can_reset_teacher_password_with_auto_generated_password(): void
    {
        $response = $this->actingAs($this->admin, 'admin')
            ->postJson("/api/v1/teachers/{$this->teacher->publicId}/account/reset-password", []);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('message', 'Password akun guru berhasil di-reset.');

        $data = $response->json('data');
        $this->assertNotEmpty($data['newPassword']);
        $this->assertStringStartsWith('Guru#', $data['newPassword']);
        $this->assertNotEmpty($data['passwordSetupUrl']);

        $this->account->refresh();
        $this->assertTrue(Hash::check($data['newPassword'], $this->account->passwordHash));
        $this->assertSame($data['newPassword'], $this->account->initialPassword);
        $this->assertTrue($this->account->mustChangePassword);

        // Audit log tercatat
        $this->assertDatabaseHas('AuditLog', [
            'action' => 'TEACHER_PASSWORD_RESET',
            'entityType' => 'TeacherAccount',
            'entityPublicId' => $this->account->publicId,
        ]);
    }

    public function test_admin_can_reset_teacher_password_with_custom_password(): void
    {
        $response = $this->actingAs($this->admin, 'admin')
            ->postJson("/api/v1/teachers/{$this->teacher->publicId}/account/reset-password", [
                'password' => 'KemenagPalembang#2026',
            ]);

        $response->assertOk()
            ->assertJsonPath('success', true);

        $this->account->refresh();
        $this->assertTrue(Hash::check('KemenagPalembang#2026', $this->account->passwordHash));
        $this->assertSame('KemenagPalembang#2026', $this->account->initialPassword);
    }

    public function test_reset_password_reactivates_disabled_or_locked_account(): void
    {
        $this->account->update([
            'status' => 'DISABLED',
            'failedLoginAttempts' => 5,
            'lockedUntil' => now()->addHour(),
        ]);

        $response = $this->actingAs($this->admin, 'admin')
            ->postJson("/api/v1/teachers/{$this->teacher->publicId}/account/reset-password", []);

        $response->assertOk();

        $this->account->refresh();
        $this->assertSame('ACTIVE', $this->account->status);
        $this->assertSame(0, $this->account->failedLoginAttempts);
        $this->assertNull($this->account->lockedUntil);
    }

    public function test_export_teacher_credentials_includes_account_even_if_password_was_changed(): void
    {
        $exportService = app(SpreadsheetExportService::class);
        $request = request();

        [$path, $count] = $exportService->teacherCredentials($request);
        $this->assertSame(1, $count);
        @unlink($path);

        $this->actingAs($this->admin, 'admin')
            ->postJson("/api/v1/teachers/{$this->teacher->publicId}/account/reset-password", [
                'password' => 'PasswordBaruGuru#2026',
            ]);

        [$pathAfter, $countAfter] = $exportService->teacherCredentials($request);
        $this->assertSame(1, $countAfter);
        @unlink($pathAfter);
    }
}

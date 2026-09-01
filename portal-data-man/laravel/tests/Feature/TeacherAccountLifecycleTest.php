<?php

namespace Tests\Feature;

use App\Mail\TeacherActivationMail;
use App\Models\AdminUser;
use App\Models\Teacher;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class TeacherAccountLifecycleTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Storage::fake('local');
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
            $t->dateTime('deletedAt')->nullable();
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
            $t->string('status')->default('PENDING_SETUP');
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
    }

    protected function tearDown(): void
    {
        foreach (['AuditLog', 'AuthSession', 'TeacherPasswordSetupToken', 'TeacherAccount', 'Teacher', 'AdminUser'] as $table) {
            Schema::dropIfExists($table);
        }parent::tearDown();
    }

    public function test_admin_provisions_account_and_teacher_uses_setup_token_once(): void
    {
        $admin = AdminUser::query()->create(['publicId' => '01ADMIN00000000000000000', 'name' => 'Admin', 'email' => 'admin@example.test', 'passwordHash' => 'hash', 'role' => 'SUPER_ADMIN', 'status' => 'ACTIVE']);
        $teacher = Teacher::query()->create(['nip' => '001122334455', 'fullName' => 'Nama Guru', 'email' => 'guru@example.test', 'status' => 'ACTIVE']);
        $created = $this->actingAs($admin, 'admin')->postJson("/api/v1/teachers/{$teacher->publicId}/account", [])->assertCreated()->assertJsonPath('data.account.username', '001122334455')->assertJsonPath('data.account.status', 'ACTIVE')->assertJsonPath('data.mailStatus', 'SENT');
        $this->postJson('/api/v1/auth/teacher/login', ['username' => '001122334455', 'password' => $created->json('data.defaultPassword')])->assertOk();
        Mail::assertSent(TeacherActivationMail::class, fn ($mail) => $mail->hasTo('guru@example.test'));
        $token = parse_url($created->json('data.passwordSetupUrl'), PHP_URL_QUERY);
        parse_str((string) $token, $query);
        $payload = ['token' => $query['token'], 'password' => 'PasswordBaru123', 'password_confirmation' => 'PasswordBaru123'];
        $this->postJson('/api/v1/auth/teacher/password-setup', $payload)->assertOk()->assertJsonPath('data.activated', true);
        $this->assertDatabaseHas('TeacherAccount', ['teacherId' => $teacher->id, 'status' => 'ACTIVE', 'mustChangePassword' => 0]);
        $this->postJson('/api/v1/auth/teacher/password-setup', $payload)->assertUnprocessable();
    }

    public function test_teacher_can_manage_profile_and_upload_valid_private_photo(): void
    {
        $teacher = Teacher::query()->create(['nip' => '001122334466', 'fullName' => 'Guru Mandiri', 'email' => 'guru@example.test', 'status' => 'ACTIVE']);
        $teacher->account()->create(['username' => '001122334466', 'email' => 'guru@example.test', 'passwordHash' => password_hash('PasswordGuru123', PASSWORD_ARGON2ID), 'status' => 'ACTIVE']);
        $this->postJson('/api/v1/auth/teacher/login', ['username' => '001122334466', 'password' => 'PasswordGuru123'])->assertOk();
        $this->patchJson('/api/v1/teacher/profile', ['email' => 'baru@example.test', 'phone' => '081234567890', 'address' => 'Alamat Baru'])->assertOk()->assertJsonPath('data.phone', '081234567890');
        $file = UploadedFile::fake()->createWithContent('guru.jpg', "\xFF\xD8\xFF\xE0".str_repeat('a', 100));
        $this->post('/api/v1/teacher/profile/photo', ['file' => $file], ['Accept' => 'application/json'])->assertOk();
        $teacher->refresh();
        Storage::disk('local')->assertExists('teacher-photos/'.$teacher->photoPath);
        $this->get('/api/v1/teacher/profile/photo')->assertOk()->assertHeader('Content-Type', 'image/jpeg');
        $invalid = UploadedFile::fake()->createWithContent('fake.jpg', 'not an image');
        $this->post('/api/v1/teacher/profile/photo', ['file' => $invalid], ['Accept' => 'application/json'])->assertUnprocessable();
    }
}

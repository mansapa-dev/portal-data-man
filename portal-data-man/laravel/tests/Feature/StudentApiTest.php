<?php

namespace Tests\Feature;

use App\Models\AdminUser;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class StudentApiTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Schema::create('AdminUser', function (Blueprint $table) {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('passwordHash');
            $table->string('role');
            $table->string('status')->default('ACTIVE');
            $table->integer('failedLoginAttempts')->default(0);
            $table->dateTime('lockedUntil')->nullable();
            $table->dateTime('lastLoginAt')->nullable();
            $table->dateTime('passwordChangedAt')->nullable();
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
            $table->dateTime('deletedAt')->nullable();
        });
        Schema::create('Student', function (Blueprint $table) {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->string('nisn', 10)->unique();
            $table->string('fullName');
            $table->string('parentPhone')->nullable();
            $table->text('address')->nullable();
            $table->string('rfidUid')->nullable()->unique();
            $table->string('status')->default('ACTIVE');
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
            $table->dateTime('deletedAt')->nullable();
        });
        Schema::create('AuditLog', function (Blueprint $table) {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->string('actorType');
            $table->string('actorPublicId')->nullable();
            $table->unsignedBigInteger('applicationClientId')->nullable();
            $table->string('action');
            $table->string('entityType')->nullable();
            $table->string('entityPublicId')->nullable();
            $table->json('oldValues')->nullable();
            $table->json('newValues')->nullable();
            $table->string('requestMethod')->nullable();
            $table->string('requestPath')->nullable();
            $table->string('ipAddress')->nullable();
            $table->string('userAgent')->nullable();
            $table->dateTime('createdAt');
        });
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('AuditLog');
        Schema::dropIfExists('Student');
        Schema::dropIfExists('AdminUser');
        parent::tearDown();
    }

    public function test_data_admin_can_create_and_list_student_without_internal_id(): void
    {
        $admin = AdminUser::query()->create(['publicId' => '01ADMIN00000000000000000', 'name' => 'Admin', 'email' => 'admin@example.test', 'passwordHash' => 'hash', 'role' => 'DATA_ADMIN', 'status' => 'ACTIVE']);
        $response = $this->actingAs($admin, 'admin')->postJson('/api/v1/students', ['nisn' => '0012345678', 'fullName' => '  Nama   Siswa  ', 'status' => 'ACTIVE']);
        $response->assertCreated()->assertJsonPath('data.nisn', '0012345678')->assertJsonPath('data.fullName', 'Nama Siswa')->assertJsonMissingPath('data.id');
        $this->actingAs($admin, 'admin')->getJson('/api/v1/students')->assertOk()->assertJsonPath('meta.total', 1);
        $this->assertDatabaseHas('AuditLog', ['action' => 'CREATE', 'entityType' => 'Student']);
    }

    public function test_auditor_cannot_mutate_students(): void
    {
        $auditor = AdminUser::query()->create(['publicId' => '01AUDITOR000000000000000', 'name' => 'Auditor', 'email' => 'audit@example.test', 'passwordHash' => 'hash', 'role' => 'AUDITOR', 'status' => 'ACTIVE']);
        $this->actingAs($auditor, 'admin')->postJson('/api/v1/students', ['nisn' => '0012345678', 'fullName' => 'Siswa'])->assertForbidden();
    }

    public function test_nisn_must_be_exactly_ten_digits(): void
    {
        $admin = AdminUser::query()->create(['publicId' => '01ADMIN00000000000000000', 'name' => 'Admin', 'email' => 'admin@example.test', 'passwordHash' => 'hash', 'role' => 'DATA_ADMIN', 'status' => 'ACTIVE']);
        $this->actingAs($admin, 'admin')->postJson('/api/v1/students', ['nisn' => '123', 'fullName' => 'Siswa'])->assertUnprocessable();
    }
}

<?php

namespace Tests\Feature;

use App\Models\AdminUser;
use App\Models\Employee;
use App\Models\ImportBatch;
use App\Services\SpreadsheetExportService;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class EmployeeApiTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Schema::create('AdminUser', function (Blueprint $table): void {
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
        Schema::create('Employee', function (Blueprint $table): void {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->string('employmentType');
            $table->string('fullName');
            $table->string('nip')->unique();
            $table->string('nuptk')->nullable()->unique();
            $table->string('position');
            $table->string('rank')->nullable();
            $table->string('gender')->nullable();
            $table->string('education')->nullable();
            $table->string('grade')->nullable();
            $table->string('status')->default('ACTIVE');
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
            $table->dateTime('deletedAt')->nullable();
        });
        Schema::create('TeacherAccount', function (Blueprint $table): void {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->unsignedBigInteger('teacherId')->nullable();
            $table->unsignedBigInteger('employeeId')->nullable()->unique();
            $table->string('username')->unique();
            $table->string('email')->nullable()->unique();
            $table->string('passwordHash')->nullable();
            $table->text('initialPassword')->nullable();
            $table->string('status')->default('ACTIVE');
            $table->boolean('mustChangePassword')->default(true);
            $table->integer('failedLoginAttempts')->default(0);
            $table->dateTime('lockedUntil')->nullable();
            $table->dateTime('lastLoginAt')->nullable();
            $table->dateTime('passwordChangedAt')->nullable();
            $table->dateTime('activatedAt')->nullable();
            $table->dateTime('disabledAt')->nullable();
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
        });
        Schema::create('TeacherPasswordSetupToken', function (Blueprint $table): void {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->unsignedBigInteger('teacherAccountId');
            $table->string('tokenHash')->unique();
            $table->dateTime('expiresAt');
            $table->dateTime('usedAt')->nullable();
            $table->dateTime('createdAt');
        });
        Schema::create('AuthSession', function (Blueprint $table): void {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->unsignedBigInteger('adminUserId')->nullable();
            $table->unsignedBigInteger('teacherAccountId')->nullable();
            $table->string('secretHash')->unique();
            $table->string('csrfHash');
            $table->string('ipAddress')->nullable();
            $table->string('userAgent')->nullable();
            $table->dateTime('lastUsedAt');
            $table->dateTime('expiresAt');
            $table->dateTime('revokedAt')->nullable();
            $table->dateTime('createdAt');
            $table->string('rotatedFrom')->nullable();
        });
        Schema::create('AuditLog', function (Blueprint $table): void {
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
        Schema::create('ImportBatch', function (Blueprint $table): void {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->string('type');
            $table->string('originalFilename');
            $table->string('storedFilename');
            $table->string('fileHash');
            $table->string('status');
            $table->integer('totalRows')->default(0);
            $table->integer('validRows')->default(0);
            $table->integer('insertedRows')->default(0);
            $table->integer('updatedRows')->default(0);
            $table->integer('skippedRows')->default(0);
            $table->integer('warningRows')->default(0);
            $table->integer('failedRows')->default(0);
            $table->string('createdBy', 26);
            $table->dateTime('startedAt')->nullable();
            $table->dateTime('completedAt')->nullable();
            $table->json('summary')->nullable();
            $table->string('errorFilePath')->nullable();
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
        });
        Schema::create('ImportRowResult', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('importBatchId');
            $table->integer('rowNumber');
            $table->string('identifier')->nullable();
            $table->string('status');
            $table->json('messages')->nullable();
            $table->json('originalData')->nullable();
            $table->json('normalizedData')->nullable();
            $table->dateTime('createdAt');
        });
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('ImportRowResult');
        Schema::dropIfExists('ImportBatch');
        Schema::dropIfExists('AuditLog');
        Schema::dropIfExists('AuthSession');
        Schema::dropIfExists('TeacherPasswordSetupToken');
        Schema::dropIfExists('TeacherAccount');
        Schema::dropIfExists('Employee');
        Schema::dropIfExists('AdminUser');
        parent::tearDown();
    }

    public function test_honorary_employee_with_blank_nuptk_and_rank_can_be_created_and_exported(): void
    {
        $admin = AdminUser::query()->create(['name' => 'Admin', 'email' => 'admin@example.test', 'passwordHash' => 'hash', 'role' => 'DATA_ADMIN', 'status' => 'ACTIVE']);
        $employee = $this->actingAs($admin, 'admin')->postJson('/api/v1/employees', [
            'employmentType' => 'HONORER',
            'fullName' => '  Siti   Aminah ',
            'nip' => 'HON-001',
            'nuptk' => '',
            'position' => 'Petugas Perpustakaan',
            'rank' => '',
            'gender' => 'FEMALE',
            'education' => 'SMA',
            'grade' => '4',
            'status' => 'ACTIVE',
        ])->assertCreated()->assertJsonPath('data.fullName', 'Siti Aminah')->assertJsonPath('data.nuptk', null)->json('data');

        $this->actingAs($admin, 'admin')->getJson('/api/v1/employees?employmentType=HONORER')->assertOk()->assertJsonPath('meta.total', 1);
        $this->actingAs($admin, 'admin')->get('/api/v1/exports/employees?employmentType=HONORER')->assertOk()->assertDownload();
        $this->assertDatabaseHas('AuditLog', ['action' => 'CREATE', 'entityPublicId' => $employee['publicId']]);
        $this->assertDatabaseHas('AuditLog', ['action' => 'EMPLOYEES_EXPORTED']);
    }

    public function test_employee_template_download_works_through_canonical_and_cached_route(): void
    {
        $admin = AdminUser::query()->create(['name' => 'Admin', 'email' => 'admin-template@example.test', 'passwordHash' => 'hash', 'role' => 'DATA_ADMIN', 'status' => 'ACTIVE']);

        $this->actingAs($admin, 'admin')->get('/api/v1/import-templates/employees')
            ->assertOk()->assertDownload('template-import-pegawai.xlsx');
        $this->actingAs($admin, 'admin')->get('/api/v1/import-templates/students?type=EMPLOYEE')
            ->assertOk()->assertDownload('template-import-pegawai.xlsx');
        $this->assertDatabaseCount('AuditLog', 2);
        $this->assertDatabaseMissing('AuditLog', ['newValues' => json_encode(['type' => 'STUDENT'])]);
    }

    public function test_admin_can_create_employee_account_and_employee_can_login(): void
    {
        $admin = AdminUser::query()->create(['name' => 'Admin', 'email' => 'admin-account@example.test', 'passwordHash' => 'hash', 'role' => 'DATA_ADMIN', 'status' => 'ACTIVE']);
        $employee = Employee::query()->create(['employmentType' => 'PPPK', 'fullName' => 'Ahmad Pegawai', 'nip' => '199001012026211099', 'position' => 'Staf Tata Usaha', 'status' => 'ACTIVE']);
        $created = $this->actingAs($admin, 'admin')->postJson("/api/v1/employees/{$employee->publicId}/account")
            ->assertCreated()
            ->assertJsonPath('data.account.username', $employee->nip);
        $password = $created->json('data.defaultPassword');

        $this->postJson('/api/v1/auth/teacher/login', ['username' => $employee->nip, 'password' => $password])
            ->assertOk()
            ->assertJsonPath('data.accountType', 'EMPLOYEE')
            ->assertJsonPath('data.fullName', 'Ahmad Pegawai');
        $this->getJson('/api/v1/auth/teacher/me')->assertOk()->assertJsonPath('data.accountType', 'EMPLOYEE');
    }

    public function test_generated_employee_workbook_can_be_uploaded_and_validated(): void
    {
        Storage::fake('local');
        $admin = AdminUser::query()->create(['name' => 'Admin', 'email' => 'admin-upload@example.test', 'passwordHash' => 'hash', 'role' => 'DATA_ADMIN', 'status' => 'ACTIVE']);
        $path = app(SpreadsheetExportService::class)->employeeTemplate();

        try {
            $response = $this->actingAs($admin, 'admin')->post('/api/v1/imports/employees/validate', [
                'file' => new UploadedFile($path, 'import-pegawai.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true),
            ]);

            $response->assertCreated()
                ->assertJsonPath('data.status', 'READY')
                ->assertJsonPath('data.summary.totalRows', 3)
                ->assertJsonPath('data.summary.failedRows', 0);
            $this->assertDatabaseHas('ImportBatch', ['type' => 'EMPLOYEE', 'status' => 'READY', 'totalRows' => 3]);
        } finally {
            @unlink($path);
        }
    }

    public function test_auditor_cannot_create_employee(): void
    {
        $auditor = AdminUser::query()->create(['name' => 'Auditor', 'email' => 'audit@example.test', 'passwordHash' => 'hash', 'role' => 'AUDITOR', 'status' => 'ACTIVE']);

        $this->actingAs($auditor, 'admin')->postJson('/api/v1/employees', ['employmentType' => 'PPPK', 'fullName' => 'Pegawai Uji', 'position' => 'Staf'])->assertForbidden();
    }

    public function test_validated_employee_import_can_be_committed_once(): void
    {
        $admin = AdminUser::query()->create(['name' => 'Admin', 'email' => 'admin-import@example.test', 'passwordHash' => 'hash', 'role' => 'DATA_ADMIN', 'status' => 'ACTIVE']);
        $batch = ImportBatch::query()->create([
            'type' => 'EMPLOYEE', 'originalFilename' => 'pegawai.xlsx', 'storedFilename' => 'pegawai.xlsx',
            'fileHash' => hash('sha256', 'pegawai'), 'status' => 'READY', 'totalRows' => 1,
            'validRows' => 1, 'warningRows' => 0, 'failedRows' => 0, 'createdBy' => $admin->publicId,
        ]);
        $batch->rows()->create([
            'rowNumber' => 2, 'identifier' => '199001012026211001', 'status' => 'VALID', 'messages' => [], 'originalData' => [],
            'normalizedData' => ['employmentType' => 'PPPK', 'fullName' => 'Pegawai PPPK', 'nip' => '199001012026211001', 'nuptk' => null, 'position' => 'Staf Tata Usaha', 'rank' => 'IX', 'gender' => 'MALE', 'education' => 'S1', 'grade' => '9', 'status' => 'ACTIVE', 'warnings' => []],
        ]);

        $this->actingAs($admin, 'admin')->postJson("/api/v1/imports/employees/{$batch->publicId}/commit")->assertOk()->assertJsonPath('data.insertedRows', 1);
        $this->actingAs($admin, 'admin')->postJson("/api/v1/imports/employees/{$batch->publicId}/commit")->assertConflict();
        $this->assertDatabaseHas('Employee', ['nip' => '199001012026211001', 'employmentType' => 'PPPK', 'rank' => 'IX']);
        $this->assertDatabaseHas('TeacherAccount', ['username' => '199001012026211001', 'status' => 'ACTIVE']);
        $this->assertTrue($this->getJson('/api/v1/employees?status=ACTIVE')->json('data.0.account.mustChangePassword'));
    }
}

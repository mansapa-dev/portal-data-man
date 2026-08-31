<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $tables = ['AdminUser', 'Teacher', 'TeacherAccount', 'AuthSession', 'PasswordResetToken', 'AcademicYear', 'Semester', 'SchoolClass', 'Student', 'ClassEnrollment', 'TeacherPasswordSetupToken', 'ApplicationClient', 'TeacherApplicationAccess', 'ImportBatch', 'ImportRowResult', 'AuditLog', 'OidcPayload'];

    public function up(): void
    {
        $existing = array_values(array_filter($this->tables, fn (string $table): bool => Schema::hasTable($table)));
        if (count($existing) === count($this->tables)) {
            return;
        }
        if ($existing !== []) {
            throw new RuntimeException('Database Portal Data hanya terisi sebagian. Pulihkan backup sebelum migration. Tabel terdeteksi: '.implode(', ', $existing));
        }
        $this->createSchema();
    }

    public function down(): void
    {
        throw new LogicException('Schema Portal Data tidak boleh dihapus melalui rollback otomatis.');
    }

    private function createSchema(): void
    {
        Schema::create('AdminUser', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->string('name', 150);
            $t->string('email', 191)->unique();
            $t->string('passwordHash');
            $t->enum('role', ['SUPER_ADMIN', 'DATA_ADMIN', 'DATA_OPERATOR', 'AUDITOR']);
            $t->enum('status', ['ACTIVE', 'INACTIVE', 'LOCKED'])->default('ACTIVE');
            $t->integer('failedLoginAttempts')->default(0);
            $t->dateTime('lockedUntil', 3)->nullable();
            $t->dateTime('lastLoginAt', 3)->nullable();
            $t->dateTime('passwordChangedAt', 3)->nullable();
            $this->timestamps($t);
            $t->dateTime('deletedAt', 3)->nullable();
        });
        Schema::create('Teacher', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->string('nip', 50)->nullable()->unique();
            $t->string('nuptk', 50)->nullable()->unique();
            $t->string('employeeNumber', 50)->nullable()->unique();
            $t->string('fullName', 191)->index();
            $t->enum('gender', ['MALE', 'FEMALE'])->nullable();
            $t->string('email', 191)->nullable()->unique();
            $t->string('phone', 30)->nullable();
            $t->text('address')->nullable();
            $t->string('photoPath', 500)->nullable();
            $t->enum('status', ['ACTIVE', 'INACTIVE', 'RETIRED', 'TRANSFERRED'])->default('ACTIVE');
            $this->timestamps($t);
            $t->dateTime('deletedAt', 3)->nullable();
            $t->index('updatedAt');
        });
        Schema::create('TeacherAccount', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->foreignId('teacherId')->unique()->constrained('Teacher')->restrictOnDelete()->cascadeOnUpdate();
            $t->string('username', 100)->unique();
            $t->string('email', 191)->nullable()->unique();
            $t->string('passwordHash')->nullable();
            $t->enum('status', ['PENDING_SETUP', 'ACTIVE', 'DISABLED', 'LOCKED'])->default('PENDING_SETUP');
            $t->boolean('mustChangePassword')->default(true);
            $t->integer('failedLoginAttempts')->default(0);
            $t->dateTime('lockedUntil', 3)->nullable();
            $t->dateTime('lastLoginAt', 3)->nullable();
            $t->dateTime('passwordChangedAt', 3)->nullable();
            $t->dateTime('activatedAt', 3)->nullable();
            $t->dateTime('disabledAt', 3)->nullable();
            $this->timestamps($t);
        });
        Schema::create('AuthSession', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->foreignId('adminUserId')->nullable()->constrained('AdminUser')->nullOnDelete()->cascadeOnUpdate();
            $t->foreignId('teacherAccountId')->nullable()->constrained('TeacherAccount')->nullOnDelete()->cascadeOnUpdate();
            $t->string('secretHash')->unique();
            $t->string('csrfHash');
            $t->string('ipAddress', 45)->nullable();
            $t->string('userAgent', 500)->nullable();
            $t->dateTime('lastUsedAt', 3)->useCurrent();
            $t->dateTime('expiresAt', 3)->index();
            $t->dateTime('revokedAt', 3)->nullable();
            $t->dateTime('createdAt', 3)->useCurrent();
            $t->string('rotatedFrom', 26)->nullable();
        });
        Schema::create('PasswordResetToken', function (Blueprint $t): void {
            $t->id();
            $t->string('tokenHash')->unique();
            $t->string('accountType', 20);
            $t->string('accountPublicId', 26)->index();
            $t->dateTime('expiresAt', 3);
            $t->dateTime('consumedAt', 3)->nullable();
            $t->dateTime('createdAt', 3)->useCurrent();
        });
        Schema::create('AcademicYear', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->string('name', 30)->unique();
            $t->date('startDate');
            $t->date('endDate');
            $t->boolean('isActive')->default(false);
            $this->timestamps($t);
        });
        Schema::create('Semester', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->foreignId('academicYearId')->constrained('AcademicYear')->restrictOnDelete()->cascadeOnUpdate();
            $t->enum('type', ['ODD', 'EVEN']);
            $t->date('startDate');
            $t->date('endDate');
            $t->boolean('isActive')->default(false);
            $this->timestamps($t);
            $t->unique(['academicYearId', 'type']);
        });
        Schema::create('SchoolClass', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->foreignId('academicYearId')->constrained('AcademicYear')->restrictOnDelete()->cascadeOnUpdate();
            $t->string('code', 30);
            $t->string('name', 100);
            $t->integer('gradeLevel');
            $t->foreignId('homeroomTeacherId')->nullable()->constrained('Teacher')->nullOnDelete()->cascadeOnUpdate();
            $t->enum('status', ['ACTIVE', 'INACTIVE', 'ARCHIVED'])->default('ACTIVE');
            $this->timestamps($t);
            $t->dateTime('deletedAt', 3)->nullable();
            $t->unique(['academicYearId', 'code']);
            $t->index('updatedAt');
        });
        Schema::create('Student', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->string('nisn', 10)->unique();
            $t->string('fullName', 191)->index();
            $t->string('parentPhone', 30)->nullable();
            $t->text('address')->nullable();
            $t->string('rfidUid', 100)->nullable()->unique();
            $t->enum('status', ['ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED', 'DROPPED_OUT'])->default('ACTIVE');
            $this->timestamps($t);
            $t->dateTime('deletedAt', 3)->nullable();
            $t->index('updatedAt');
        });
        Schema::create('ClassEnrollment', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->foreignId('studentId')->constrained('Student')->restrictOnDelete()->cascadeOnUpdate();
            $t->foreignId('schoolClassId')->constrained('SchoolClass')->restrictOnDelete()->cascadeOnUpdate();
            $t->foreignId('academicYearId')->constrained('AcademicYear')->restrictOnDelete()->cascadeOnUpdate();
            $t->foreignId('semesterId')->constrained('Semester')->restrictOnDelete()->cascadeOnUpdate();
            $t->integer('attendanceNumber')->nullable();
            $t->string('activeEnrollmentKey', 64)->nullable()->unique();
            $t->dateTime('enrolledAt', 3)->useCurrent();
            $t->dateTime('leftAt', 3)->nullable();
            $t->enum('status', ['ACTIVE', 'MOVED', 'COMPLETED', 'CANCELLED'])->default('ACTIVE');
            $this->timestamps($t);
            $t->unique(['schoolClassId', 'semesterId', 'attendanceNumber']);
            $t->index(['studentId', 'semesterId', 'status']);
            $t->index('updatedAt');
        });
        Schema::create('TeacherPasswordSetupToken', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->foreignId('teacherAccountId')->constrained('TeacherAccount')->cascadeOnDelete()->cascadeOnUpdate();
            $t->string('tokenHash', 64)->unique();
            $t->dateTime('expiresAt', 3);
            $t->dateTime('usedAt', 3)->nullable();
            $t->dateTime('createdAt', 3)->useCurrent();
            $t->index(['teacherAccountId', 'expiresAt']);
        });
        Schema::create('ApplicationClient', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->string('name', 150);
            $t->string('slug', 100)->unique();
            $t->string('clientId', 191)->unique();
            $t->string('clientSecretHash')->nullable();
            $t->enum('clientType', ['CONFIDENTIAL_WEB', 'PUBLIC_WEB', 'SERVICE']);
            $t->enum('status', ['ACTIVE', 'INACTIVE'])->default('ACTIVE');
            $t->json('redirectUris')->nullable();
            $t->json('postLogoutRedirectUris')->nullable();
            $t->json('allowedOrigins')->nullable();
            $t->json('allowedScopes');
            $t->json('allowedGrantTypes');
            $t->string('logoPath', 500)->nullable();
            $t->text('description')->nullable();
            $t->integer('accessTokenLifetime')->default(900);
            $t->integer('refreshTokenLifetime')->default(2592000);
            $this->timestamps($t);
        });
        Schema::create('TeacherApplicationAccess', function (Blueprint $t): void {
            $t->id();
            $t->foreignId('teacherId')->constrained('Teacher')->restrictOnDelete()->cascadeOnUpdate();
            $t->foreignId('applicationClientId')->constrained('ApplicationClient')->restrictOnDelete()->cascadeOnUpdate();
            $t->string('role', 100);
            $t->enum('status', ['ACTIVE', 'INACTIVE'])->default('ACTIVE');
            $t->dateTime('grantedAt', 3)->useCurrent();
            $t->string('grantedBy', 26);
            $this->timestamps($t);
            $t->unique(['teacherId', 'applicationClientId']);
        });
        Schema::create('ImportBatch', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->enum('type', ['STUDENT', 'TEACHER']);
            $t->string('originalFilename');
            $t->string('storedFilename');
            $t->string('fileHash', 64);
            $t->enum('status', ['UPLOADED', 'VALIDATING', 'READY', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'])->default('UPLOADED');
            $t->integer('totalRows')->default(0);
            $t->integer('validRows')->default(0);
            $t->integer('insertedRows')->default(0);
            $t->integer('updatedRows')->default(0);
            $t->integer('skippedRows')->default(0);
            $t->integer('warningRows')->default(0);
            $t->integer('failedRows')->default(0);
            $t->string('createdBy', 26);
            $t->dateTime('startedAt', 3)->nullable();
            $t->dateTime('completedAt', 3)->nullable();
            $t->json('summary')->nullable();
            $t->string('errorFilePath', 500)->nullable();
            $this->timestamps($t);
            $t->index(['fileHash', 'type']);
        });
        Schema::create('ImportRowResult', function (Blueprint $t): void {
            $t->id();
            $t->foreignId('importBatchId')->constrained('ImportBatch')->cascadeOnDelete()->cascadeOnUpdate();
            $t->integer('rowNumber');
            $t->string('identifier', 191)->nullable();
            $t->enum('status', ['VALID', 'INSERTED', 'UPDATED', 'SKIPPED', 'WARNING', 'FAILED']);
            $t->json('messages')->nullable();
            $t->json('originalData')->nullable();
            $t->json('normalizedData')->nullable();
            $t->dateTime('createdAt', 3)->useCurrent();
            $t->unique(['importBatchId', 'rowNumber']);
        });
        Schema::create('AuditLog', function (Blueprint $t): void {
            $t->id();
            $t->string('publicId', 26)->unique();
            $t->enum('actorType', ['ADMIN', 'TEACHER', 'APPLICATION', 'SYSTEM']);
            $t->string('actorPublicId', 26)->nullable();
            $t->foreignId('applicationClientId')->nullable()->constrained('ApplicationClient')->nullOnDelete()->cascadeOnUpdate();
            $t->string('action', 100);
            $t->string('entityType', 100)->nullable();
            $t->string('entityPublicId', 26)->nullable();
            $t->json('oldValues')->nullable();
            $t->json('newValues')->nullable();
            $t->string('requestMethod', 10)->nullable();
            $t->string('requestPath', 500)->nullable();
            $t->string('ipAddress', 45)->nullable();
            $t->string('userAgent', 500)->nullable();
            $t->dateTime('createdAt', 3)->useCurrent();
            $t->index(['entityType', 'entityPublicId']);
            $t->index('createdAt');
        });
        Schema::create('OidcPayload', function (Blueprint $t): void {
            $t->string('id', 191)->primary();
            $t->string('kind', 50);
            $t->json('payload');
            $t->string('grantId', 191)->nullable()->index();
            $t->string('userCode', 191)->nullable()->unique();
            $t->string('uid', 191)->nullable()->index();
            $t->dateTime('expiresAt', 3);
            $t->dateTime('consumedAt', 3)->nullable();
            $t->dateTime('createdAt', 3)->useCurrent();
            $t->index(['kind', 'expiresAt']);
        });
    }

    private function timestamps(Blueprint $table): void
    {
        $table->dateTime('createdAt', 3)->useCurrent();
        $table->dateTime('updatedAt', 3)->useCurrent();
    }
};

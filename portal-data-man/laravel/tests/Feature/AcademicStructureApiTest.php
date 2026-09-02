<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\AdminUser;
use App\Models\ClassEnrollment;
use App\Models\ImportBatch;
use App\Models\SchoolClass;
use App\Models\Semester;
use App\Models\Student;
use App\Models\Teacher;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AcademicStructureApiTest extends TestCase
{
    private AdminUser $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createTables();
        $this->admin = AdminUser::query()->create(['name' => 'Admin', 'email' => 'admin@example.test', 'passwordHash' => 'hash', 'role' => 'DATA_ADMIN', 'status' => 'ACTIVE']);
    }

    protected function tearDown(): void
    {
        foreach (['AuditLog', 'ImportRowResult', 'ImportBatch', 'ClassEnrollment', 'SchoolClass', 'Teacher', 'Student', 'Semester', 'AcademicYear', 'AdminUser'] as $table) {
            Schema::dropIfExists($table);
        }
        parent::tearDown();
    }

    public function test_periods_can_be_created_and_only_one_semester_is_active(): void
    {
        $year = $this->actingAs($this->admin, 'admin')->postJson('/api/v1/academic-years', ['name' => '2026/2027', 'startDate' => '2026-07-01', 'endDate' => '2027-06-30', 'isActive' => true])->assertCreated()->json('data');
        $odd = $this->actingAs($this->admin, 'admin')->postJson('/api/v1/semesters', ['academicYearPublicId' => $year['publicId'], 'type' => 'ODD', 'startDate' => '2026-07-01', 'endDate' => '2026-12-31'])->assertCreated()->json('data');
        $even = $this->actingAs($this->admin, 'admin')->postJson('/api/v1/semesters', ['academicYearPublicId' => $year['publicId'], 'type' => 'EVEN', 'startDate' => '2027-01-01', 'endDate' => '2027-06-30'])->assertCreated()->json('data');

        $this->actingAs($this->admin, 'admin')->postJson("/api/v1/semesters/{$odd['publicId']}/activate")->assertOk();
        $this->actingAs($this->admin, 'admin')->postJson("/api/v1/semesters/{$even['publicId']}/activate")->assertOk();

        $this->assertFalse(Semester::query()->where('publicId', $odd['publicId'])->value('isActive'));
        $this->assertTrue(Semester::query()->where('publicId', $even['publicId'])->value('isActive'));
    }

    public function test_academic_year_must_be_one_year_and_semesters_must_use_six_month_halves(): void
    {
        $this->actingAs($this->admin, 'admin')->postJson('/api/v1/academic-years', ['name' => '2026/2027', 'startDate' => '2026-07-01', 'endDate' => '2027-07-01'])->assertUnprocessable();
        $year = $this->actingAs($this->admin, 'admin')->postJson('/api/v1/academic-years', ['name' => '2026/2027', 'startDate' => '2026-07-01', 'endDate' => '2027-06-30'])->assertCreated()->json('data');

        $this->actingAs($this->admin, 'admin')->postJson('/api/v1/semesters', ['academicYearPublicId' => $year['publicId'], 'type' => 'ODD', 'startDate' => '2026-07-01', 'endDate' => '2027-01-01'])->assertUnprocessable();
        $this->actingAs($this->admin, 'admin')->postJson('/api/v1/semesters', ['academicYearPublicId' => $year['publicId'], 'type' => 'EVEN', 'startDate' => '2026-12-31', 'endDate' => '2027-06-30'])->assertUnprocessable();
    }

    public function test_class_code_is_normalized_and_teacher_cannot_be_duplicate_homeroom(): void
    {
        [$year, , $teacher] = $this->fixtures();
        $class = $this->actingAs($this->admin, 'admin')->postJson('/api/v1/classes', ['academicYearPublicId' => $year->publicId, 'code' => 'XlI.9', 'name' => 'Kelas XII 9', 'gradeLevel' => 12, 'homeroomTeacherPublicId' => $teacher->publicId])->assertCreated()->assertJsonPath('data.code', 'XII.9')->json('data');

        $this->assertArrayNotHasKey('id', $class);
        $this->actingAs($this->admin, 'admin')->postJson('/api/v1/classes', ['academicYearPublicId' => $year->publicId, 'code' => 'XlI.10', 'name' => 'Kelas XII 10', 'gradeLevel' => 12, 'homeroomTeacherPublicId' => $teacher->publicId])->assertConflict();
    }

    public function test_enrollment_is_unique_and_move_is_atomic(): void
    {
        [$year, $semester] = $this->fixtures();
        $student = Student::query()->create(['nisn' => '0012345678', 'fullName' => 'Siswa', 'status' => 'ACTIVE']);
        $source = SchoolClass::query()->create(['academicYearId' => $year->id, 'code' => 'XII.9', 'name' => 'XII 9', 'gradeLevel' => 12, 'status' => 'ACTIVE']);
        $target = SchoolClass::query()->create(['academicYearId' => $year->id, 'code' => 'XII.10', 'name' => 'XII 10', 'gradeLevel' => 12, 'status' => 'ACTIVE']);

        $created = $this->actingAs($this->admin, 'admin')->postJson("/api/v1/classes/{$source->publicId}/students", ['studentPublicId' => $student->publicId, 'semesterPublicId' => $semester->publicId, 'attendanceNumber' => 1])->assertCreated()->json('data');
        $this->actingAs($this->admin, 'admin')->postJson("/api/v1/classes/{$target->publicId}/students", ['studentPublicId' => $student->publicId, 'semesterPublicId' => $semester->publicId, 'attendanceNumber' => 2])->assertConflict();

        $this->actingAs($this->admin, 'admin')->postJson("/api/v1/enrollments/{$created['publicId']}/move", ['targetClassPublicId' => $target->publicId, 'attendanceNumber' => 2])->assertOk()->assertJsonPath('data.schoolClass.publicId', $target->publicId);

        $this->assertSame(1, ClassEnrollment::query()->where('studentId', $student->id)->where('semesterId', $semester->id)->where('status', 'ACTIVE')->count());
        $this->assertDatabaseHas('ClassEnrollment', ['publicId' => $created['publicId'], 'status' => 'MOVED', 'activeEnrollmentKey' => null]);
    }

    public function test_import_commit_is_single_use_and_reimport_is_idempotent(): void
    {
        [, $semester] = $this->fixtures();
        $first = $this->importBatch($semester, 'batch-one.xlsx');

        $this->actingAs($this->admin, 'admin')->postJson("/api/v1/imports/students/{$first->publicId}/commit")->assertOk()->assertJsonPath('data.insertedRows', 2);
        $this->actingAs($this->admin, 'admin')->postJson("/api/v1/imports/students/{$first->publicId}/commit")->assertConflict();

        $second = $this->importBatch($semester, 'batch-two.xlsx');
        $this->actingAs($this->admin, 'admin')->postJson("/api/v1/imports/students/{$second->publicId}/commit")->assertOk()->assertJsonPath('data.skippedRows', 2);

        $this->assertSame(2, Student::query()->count());
        $this->assertSame(2, ClassEnrollment::query()->where('status', 'ACTIVE')->count());
        $this->assertSame(2, SchoolClass::query()->count());
    }

    private function fixtures(): array
    {
        $year = AcademicYear::query()->create(['name' => '2026/2027', 'startDate' => '2026-07-01', 'endDate' => '2027-06-30', 'isActive' => true]);
        $semester = Semester::query()->create(['academicYearId' => $year->id, 'type' => 'ODD', 'startDate' => '2026-07-01', 'endDate' => '2026-12-31', 'isActive' => true]);
        $teacher = Teacher::query()->create(['nip' => '19870001', 'fullName' => 'Guru', 'status' => 'ACTIVE']);

        return [$year, $semester, $teacher];
    }

    private function importBatch(Semester $semester, string $filename): ImportBatch
    {
        $batch = ImportBatch::query()->create(['type' => 'STUDENT', 'originalFilename' => $filename, 'storedFilename' => $filename, 'fileHash' => hash('sha256', $filename), 'status' => 'READY', 'totalRows' => 2, 'validRows' => 2, 'warningRows' => 0, 'failedRows' => 0, 'createdBy' => $this->admin->publicId, 'summary' => ['totalRows' => 2]]);
        foreach ([['0012345678', 'Siswa Satu', 'XII.9'], ['0012345679', 'Siswa Dua', 'XII.10']] as $index => [$nisn, $name, $class]) {
            $batch->rows()->create(['rowNumber' => $index + 2, 'identifier' => $nisn, 'status' => 'VALID', 'messages' => [], 'originalData' => [], 'normalizedData' => ['nisn' => $nisn, 'fullName' => $name, 'classCode' => $class, 'gradeLevel' => 12, 'parentPhone' => null, 'address' => null, 'rfidUid' => null, 'status' => 'ACTIVE', 'warnings' => []]]);
        }

        return $batch;
    }

    private function createTables(): void
    {
        Schema::create('AdminUser', function (Blueprint $table) {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('passwordHash');
            $table->string('role');
            $table->string('status');
            $table->integer('failedLoginAttempts')->default(0);
            $table->dateTime('lockedUntil')->nullable();
            $table->dateTime('lastLoginAt')->nullable();
            $table->dateTime('passwordChangedAt')->nullable();
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
            $table->dateTime('deletedAt')->nullable();
        });
        Schema::create('AcademicYear', function (Blueprint $table) {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->string('name')->unique();
            $table->date('startDate');
            $table->date('endDate');
            $table->boolean('isActive')->default(false);
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
        });
        Schema::create('Semester', function (Blueprint $table) {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->unsignedBigInteger('academicYearId');
            $table->string('type');
            $table->date('startDate');
            $table->date('endDate');
            $table->boolean('isActive')->default(false);
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
            $table->unique(['academicYearId', 'type']);
        });
        Schema::create('Student', function (Blueprint $table) {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->string('nisn', 10)->unique();
            $table->string('fullName');
            $table->string('parentPhone')->nullable();
            $table->text('address')->nullable();
            $table->string('rfidUid')->nullable()->unique();
            $table->string('status');
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
            $table->dateTime('deletedAt')->nullable();
        });
        Schema::create('Teacher', function (Blueprint $table) {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->string('nip')->nullable()->unique();
            $table->string('nuptk')->nullable()->unique();
            $table->string('employeeNumber')->nullable()->unique();
            $table->string('fullName');
            $table->string('gender')->nullable();
            $table->string('email')->nullable()->unique();
            $table->string('phone')->nullable();
            $table->text('address')->nullable();
            $table->string('photoPath')->nullable();
            $table->string('status');
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
            $table->dateTime('deletedAt')->nullable();
        });
        Schema::create('SchoolClass', function (Blueprint $table) {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->unsignedBigInteger('academicYearId');
            $table->string('code');
            $table->string('name');
            $table->integer('gradeLevel');
            $table->unsignedBigInteger('homeroomTeacherId')->nullable();
            $table->string('status');
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
            $table->dateTime('deletedAt')->nullable();
            $table->unique(['academicYearId', 'code']);
        });
        Schema::create('ClassEnrollment', function (Blueprint $table) {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->unsignedBigInteger('studentId');
            $table->unsignedBigInteger('schoolClassId');
            $table->unsignedBigInteger('academicYearId');
            $table->unsignedBigInteger('semesterId');
            $table->integer('attendanceNumber')->nullable();
            $table->string('activeEnrollmentKey')->nullable()->unique();
            $table->dateTime('enrolledAt')->useCurrent();
            $table->dateTime('leftAt')->nullable();
            $table->string('status')->default('ACTIVE');
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
            $table->unique(['schoolClassId', 'semesterId', 'attendanceNumber']);
        });
        Schema::create('ImportBatch', function (Blueprint $table) {
            $table->id();
            $table->string('publicId', 26)->unique();
            $table->string('type');
            $table->string('originalFilename');
            $table->string('storedFilename');
            $table->string('fileHash', 64);
            $table->string('status')->default('UPLOADED');
            $table->integer('totalRows')->default(0);
            $table->integer('validRows')->default(0);
            $table->integer('insertedRows')->default(0);
            $table->integer('updatedRows')->default(0);
            $table->integer('skippedRows')->default(0);
            $table->integer('warningRows')->default(0);
            $table->integer('failedRows')->default(0);
            $table->string('createdBy');
            $table->dateTime('startedAt')->nullable();
            $table->dateTime('completedAt')->nullable();
            $table->json('summary')->nullable();
            $table->string('errorFilePath')->nullable();
            $table->dateTime('createdAt');
            $table->dateTime('updatedAt');
        });
        Schema::create('ImportRowResult', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('importBatchId');
            $table->integer('rowNumber');
            $table->string('identifier')->nullable();
            $table->string('status');
            $table->json('messages')->nullable();
            $table->json('originalData')->nullable();
            $table->json('normalizedData')->nullable();
            $table->dateTime('createdAt');
            $table->unique(['importBatchId', 'rowNumber']);
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
}

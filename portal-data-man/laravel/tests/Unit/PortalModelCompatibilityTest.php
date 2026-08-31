<?php

namespace Tests\Unit;

use App\Models\AdminUser;
use App\Models\ClassEnrollment;
use App\Models\Student;
use App\Models\TeacherAccount;
use PHPUnit\Framework\TestCase;

class PortalModelCompatibilityTest extends TestCase
{
    public function test_models_keep_legacy_table_and_public_route_keys(): void
    {
        $student = new Student;
        $this->assertSame('Student', $student->getTable());
        $this->assertSame('publicId', $student->getRouteKeyName());
        $this->assertSame('createdAt', $student->getCreatedAtColumn());
        $this->assertSame('updatedAt', $student->getUpdatedAtColumn());
    }

    public function test_sensitive_and_internal_fields_are_hidden(): void
    {
        $admin = (new AdminUser)->forceFill(['id' => 1, 'passwordHash' => 'secret']);
        $teacher = (new TeacherAccount)->forceFill(['id' => 2, 'teacherId' => 3, 'passwordHash' => 'secret']);
        $enrollment = (new ClassEnrollment)->forceFill(['id' => 4, 'studentId' => 5, 'schoolClassId' => 6]);
        $this->assertArrayNotHasKey('id', $admin->toArray());
        $this->assertArrayNotHasKey('passwordHash', $admin->toArray());
        $this->assertArrayNotHasKey('teacherId', $teacher->toArray());
        $this->assertArrayNotHasKey('passwordHash', $teacher->toArray());
        $this->assertArrayNotHasKey('studentId', $enrollment->toArray());
    }

    public function test_authentication_reads_existing_password_hash_column(): void
    {
        $this->assertSame('passwordHash', (new AdminUser)->getAuthPasswordName());
        $this->assertSame('passwordHash', (new TeacherAccount)->getAuthPasswordName());
    }
}

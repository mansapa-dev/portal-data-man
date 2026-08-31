<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $requiredTables = [
            'AdminUser', 'AuthSession', 'PasswordResetToken', 'AcademicYear',
            'Semester', 'SchoolClass', 'Student', 'Teacher', 'TeacherAccount',
            'TeacherPasswordSetupToken', 'ClassEnrollment', 'ApplicationClient',
            'TeacherApplicationAccess', 'ImportBatch', 'ImportRowResult',
            'AuditLog', 'OidcPayload',
        ];

        $missing = array_values(array_filter(
            $requiredTables,
            fn (string $table): bool => ! Schema::hasTable($table)
        ));

        if ($missing !== []) {
            throw new RuntimeException(
                'Schema Portal Data belum lengkap. Restore backup MySQL terlebih dahulu. Tabel hilang: '.implode(', ', $missing)
            );
        }

        $requiredColumns = [
            'AdminUser' => ['publicId', 'email', 'passwordHash', 'role', 'deletedAt'],
            'Student' => ['publicId', 'nisn', 'fullName', 'deletedAt'],
            'Teacher' => ['publicId', 'fullName', 'deletedAt'],
            'TeacherAccount' => ['publicId', 'teacherId', 'username', 'passwordHash', 'status'],
            'ClassEnrollment' => ['publicId', 'studentId', 'semesterId', 'activeEnrollmentKey'],
        ];

        foreach ($requiredColumns as $table => $columns) {
            foreach ($columns as $column) {
                if (! Schema::hasColumn($table, $column)) {
                    throw new RuntimeException("Kolom wajib {$table}.{$column} tidak ditemukan.");
                }
            }
        }
    }

    public function down(): void
    {
        throw new LogicException('Baseline schema Portal Data tidak boleh di-rollback otomatis.');
    }
};

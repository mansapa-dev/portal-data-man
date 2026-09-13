<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('TeacherAccount', 'employeeId')) {
            Schema::table('TeacherAccount', function (Blueprint $table): void {
                $table->foreignId('employeeId')->nullable()->after('teacherId')->unique()->constrained('Employee')->restrictOnDelete()->cascadeOnUpdate();
            });
        }
        if (! Schema::hasColumn('TeacherApplicationAccess', 'employeeId')) {
            Schema::table('TeacherApplicationAccess', function (Blueprint $table): void {
                $table->foreignId('employeeId')->nullable()->after('teacherId')->constrained('Employee')->restrictOnDelete()->cascadeOnUpdate();
                $table->unique(['employeeId', 'applicationClientId'], 'employee_application_unique');
            });
        }

        $this->nullable('TeacherAccount', 'teacherId');
        $this->nullable('TeacherApplicationAccess', 'teacherId');
    }

    public function down(): void
    {
        abort_if(DB::table('TeacherAccount')->whereNotNull('employeeId')->exists(), 409, 'Migration tidak dapat dibatalkan selama akun pegawai masih tersedia.');
        abort_if(DB::table('TeacherApplicationAccess')->whereNotNull('employeeId')->exists(), 409, 'Migration tidak dapat dibatalkan selama akses pegawai masih tersedia.');

        Schema::table('TeacherApplicationAccess', function (Blueprint $table): void {
            $table->dropUnique('employee_application_unique');
            $table->dropConstrainedForeignId('employeeId');
        });
        Schema::table('TeacherAccount', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('employeeId');
        });
        $this->notNullable('TeacherAccount', 'teacherId');
        $this->notNullable('TeacherApplicationAccess', 'teacherId');
    }

    private function nullable(string $table, string $column): void
    {
        if (DB::getDriverName() === 'mysql') {
            DB::statement("ALTER TABLE `{$table}` MODIFY `{$column}` BIGINT UNSIGNED NULL");
        } else {
            Schema::table($table, fn (Blueprint $blueprint) => $blueprint->unsignedBigInteger($column)->nullable()->change());
        }
    }

    private function notNullable(string $table, string $column): void
    {
        if (DB::getDriverName() === 'mysql') {
            DB::statement("ALTER TABLE `{$table}` MODIFY `{$column}` BIGINT UNSIGNED NOT NULL");
        } else {
            Schema::table($table, fn (Blueprint $blueprint) => $blueprint->unsignedBigInteger($column)->nullable(false)->change());
        }
    }
};

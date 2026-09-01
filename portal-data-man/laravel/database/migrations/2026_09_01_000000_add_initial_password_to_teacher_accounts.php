<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('TeacherAccount', 'initialPassword')) {
            Schema::table('TeacherAccount', function (Blueprint $table): void {
                $table->text('initialPassword')->nullable()->after('passwordHash');
            });
        }
    }

    public function down(): void
    {
        Schema::table('TeacherAccount', function (Blueprint $table): void {
            $table->dropColumn('initialPassword');
        });
    }
};

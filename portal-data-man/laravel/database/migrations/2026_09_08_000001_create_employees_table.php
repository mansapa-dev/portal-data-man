<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('Employee')) {
            Schema::create('Employee', function (Blueprint $table): void {
                $table->id();
                $table->string('publicId', 26)->unique();
                $table->enum('employmentType', ['PNS', 'PPPK', 'HONORER'])->index();
                $table->string('fullName', 191)->index();
                $table->string('nip', 50)->unique();
                $table->string('nuptk', 50)->nullable()->unique();
                $table->string('position', 191);
                $table->string('rank', 100)->nullable();
                $table->enum('gender', ['MALE', 'FEMALE'])->nullable();
                $table->string('education', 191)->nullable();
                $table->string('grade', 100)->nullable();
                $table->enum('status', ['ACTIVE', 'INACTIVE'])->default('ACTIVE')->index();
                $table->dateTime('createdAt', 3)->useCurrent();
                $table->dateTime('updatedAt', 3)->useCurrent();
                $table->dateTime('deletedAt', 3)->nullable();
            });
        }

        if (DB::getDriverName() === 'mysql') {
            DB::statement("ALTER TABLE `ImportBatch` MODIFY `type` ENUM('STUDENT','TEACHER','EMPLOYEE') NOT NULL");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('Employee');
    }
};

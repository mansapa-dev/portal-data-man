<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() === 'mysql' && Schema::hasTable('Employee')) {
            DB::statement("ALTER TABLE `Employee` MODIFY `employmentType` ENUM('PNS','PPPK','HONORER') NOT NULL");
        }
    }

    public function down(): void
    {
        // Removing PNS would invalidate existing employee records, so this
        // compatibility expansion is intentionally not reversed.
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('Employee', 'employeeNumber')) {
            Schema::table('Employee', function (Blueprint $table): void {
                $table->string('employeeNumber', 50)->nullable()->unique()->after('nuptk');
            });
        }
        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE `Employee` MODIFY `nip` VARCHAR(50) NULL');
        } else {
            Schema::table('Employee', fn (Blueprint $table) => $table->string('nip', 50)->nullable()->change());
        }
        DB::table('Employee')->whereNull('employeeNumber')->where('nip', 'like', 'HON-%')->update([
            'employeeNumber' => DB::raw('nip'),
            'nip' => null,
        ]);
    }

    public function down(): void
    {
        abort_if(DB::table('Employee')->whereNull('nip')->exists(), 409, 'Migration tidak dapat dibatalkan selama ada pegawai tanpa NIP.');
        Schema::table('Employee', fn (Blueprint $table) => $table->dropColumn('employeeNumber'));
    }
};

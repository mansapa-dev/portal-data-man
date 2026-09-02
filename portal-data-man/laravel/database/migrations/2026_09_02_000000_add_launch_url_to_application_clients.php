<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('ApplicationClient', 'launchUrl')) {
            Schema::table('ApplicationClient', function (Blueprint $table): void {
                $table->string('launchUrl', 2000)->nullable()->after('description');
            });
        }
    }

    public function down(): void
    {
        Schema::table('ApplicationClient', function (Blueprint $table): void {
            $table->dropColumn('launchUrl');
        });
    }
};

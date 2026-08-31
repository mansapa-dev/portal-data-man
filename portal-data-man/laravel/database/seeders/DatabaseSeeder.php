<?php

namespace Database\Seeders;

use App\Models\AdminUser;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $name = trim((string) env('SUPER_ADMIN_NAME'));
        $email = strtolower(trim((string) env('SUPER_ADMIN_EMAIL')));
        $password = (string) env('SUPER_ADMIN_PASSWORD');
        if ($name === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 12) {
            throw new RuntimeException('SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL valid, dan SUPER_ADMIN_PASSWORD minimal 12 karakter wajib diisi.');
        }
        AdminUser::query()->updateOrCreate(
            ['email' => $email],
            ['name' => $name, 'passwordHash' => Hash::make($password), 'role' => 'SUPER_ADMIN', 'status' => 'ACTIVE', 'failedLoginAttempts' => 0, 'lockedUntil' => null, 'deletedAt' => null]
        );
    }
}

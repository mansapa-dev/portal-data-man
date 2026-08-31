<?php

use App\Models\AdminUser;
use App\Models\TeacherAccount;

return [
    'defaults' => ['guard' => env('AUTH_GUARD', 'admin'), 'passwords' => 'admins'],
    'guards' => [
        'admin' => ['driver' => 'session', 'provider' => 'admins'],
        'teacher' => ['driver' => 'session', 'provider' => 'teachers'],
    ],
    'providers' => [
        'admins' => ['driver' => 'eloquent', 'model' => AdminUser::class],
        'teachers' => ['driver' => 'eloquent', 'model' => TeacherAccount::class],
    ],
    'passwords' => [
        'admins' => ['provider' => 'admins', 'table' => 'PasswordResetToken', 'expire' => 60, 'throttle' => 60],
        'teachers' => ['provider' => 'teachers', 'table' => 'PasswordResetToken', 'expire' => 60, 'throttle' => 60],
    ],
    'password_timeout' => env('AUTH_PASSWORD_TIMEOUT', 10800),
];

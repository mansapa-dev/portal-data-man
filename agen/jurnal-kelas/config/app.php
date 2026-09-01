<?php
return ['name' => env('APP_NAME', 'Jurnal Kelas'), 'env' => env('APP_ENV', 'production'), 'debug' => filter_var(env('APP_DEBUG', false), FILTER_VALIDATE_BOOL), 'url' => rtrim((string) env('APP_URL', ''), '/'), 'timezone' => env('APP_TIMEZONE', 'Asia/Jakarta')];

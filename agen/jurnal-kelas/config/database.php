<?php
return ['driver' => 'mysql', 'host' => env('DB_HOST', '127.0.0.1'), 'port' => (int) env('DB_PORT', 3306), 'database' => env('DB_DATABASE', 'jurnal_kelas'), 'username' => env('DB_USERNAME', ''), 'password' => env('DB_PASSWORD', ''), 'charset' => 'utf8mb4'];

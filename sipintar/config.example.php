<?php
// Copy outside the document root; set SIPINTAR_CONFIG to the absolute path.
return [
    // Local accounts, roles, employee cache and transactions live in this project's database.
    'database' => ['host' => '127.0.0.1', 'port' => 3306, 'database' => 'sipintar_db', 'user' => '', 'password' => ''],
    // Both projects read the same master source in portal-data-man, using their own service clients.
    'portal' => ['teachers_url' => 'https://portal.example/api/v1/integration/cbt/teachers', 'token_url' => 'https://portal.example/oidc/token', 'client_id' => '', 'client_secret' => ''],
    'cookie_secure' => true,
];

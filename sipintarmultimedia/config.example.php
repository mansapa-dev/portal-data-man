<?php
// Copy outside the document root; set SIPINTARMULTIMEDIA_CONFIG to the absolute path.
return [
    // Production application URL: https://sipintarmulmed.rdmman1plg.id
    // Local accounts, roles, employee cache and transactions live in this project's database.
    'database' => ['host' => '127.0.0.1', 'port' => 3306, 'database' => 'db_sarpras', 'user' => '', 'password' => ''],
    // Both projects read the same master source in portal-data-man, using their own service clients.
    'portal' => ['employees_url' => 'https://sipadu.man1palembang.sch.id/api/v1/integration/cbt/employees', 'token_url' => 'https://sipadu.man1palembang.sch.id/oidc/token', 'client_id' => '', 'client_secret' => ''],
    'cookie_secure' => true,
];

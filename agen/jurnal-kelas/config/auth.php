<?php
return [
    'session_lifetime' => (int) env('SESSION_LIFETIME', 31536000), // Default 1 tahun (365 hari) agar sesi guru tetap aktif
    'secure_cookie' => filter_var(env('SESSION_SECURE', false), FILTER_VALIDATE_BOOL),
    'roles' => ['ADMIN', 'TEACHER', 'AUDITOR']
];

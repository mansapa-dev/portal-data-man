<?php
return ['session_lifetime' => (int) env('SESSION_LIFETIME', 7200), 'secure_cookie' => filter_var(env('SESSION_SECURE', true), FILTER_VALIDATE_BOOL), 'roles' => ['ADMIN', 'TEACHER', 'AUDITOR']];

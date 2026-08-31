<?php

return [
    'issuer' => rtrim(env('OIDC_ISSUER', env('APP_URL', 'http://localhost').'/oidc'), '/'),
    'private_key_path' => env('OIDC_PRIVATE_KEY_PATH') ?: storage_path('app/private/oidc/private.pem'),
    'public_key_path' => env('OIDC_PUBLIC_KEY_PATH') ?: storage_path('app/private/oidc/public.pem'),
    'key_id' => env('OIDC_KEY_ID', 'portal-data-signing-1'),
    'access_token_ttl' => (int) env('OIDC_ACCESS_TOKEN_TTL', 900),
    'authorization_code_ttl' => (int) env('OIDC_AUTHORIZATION_CODE_TTL', 600),
];

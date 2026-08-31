<?php

namespace App\Services;

use RuntimeException;

class OidcTokenService
{
    public function sign(array $claims): string
    {
        $private = @file_get_contents(config('oidc.private_key_path'));
        if (! $private) {
            throw new RuntimeException('OIDC private key belum tersedia. Jalankan php artisan portal:oidc-key-generate.');
        }
        $header = ['alg' => 'RS256', 'typ' => 'JWT', 'kid' => config('oidc.key_id')];
        $input = $this->encode(json_encode($header, JSON_THROW_ON_ERROR)).'.'.$this->encode(json_encode($claims, JSON_THROW_ON_ERROR));
        abort_unless(openssl_sign($input, $signature, $private, OPENSSL_ALGO_SHA256), 500, 'Token OIDC gagal ditandatangani.');

        return $input.'.'.$this->encode($signature);
    }

    public function verify(string $jwt): ?array
    {
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            return null;
        }
        $public = @file_get_contents(config('oidc.public_key_path'));
        if (! $public || openssl_verify($parts[0].'.'.$parts[1], $this->decode($parts[2]), $public, OPENSSL_ALGO_SHA256) !== 1) {
            return null;
        }
        $claims = json_decode($this->decode($parts[1]), true);
        if (! is_array($claims) || ($claims['exp'] ?? 0) <= time() || ($claims['iss'] ?? null) !== config('oidc.issuer')) {
            return null;
        }

        return $claims;
    }

    public function jwk(): array
    {
        $public = @file_get_contents(config('oidc.public_key_path'));
        $key = $public ? openssl_pkey_get_public($public) : false;
        $details = $key ? openssl_pkey_get_details($key) : false;
        if (! is_array($details) || ! isset($details['rsa'])) {
            throw new RuntimeException('OIDC public key belum tersedia atau tidak valid.');
        }

        return ['kty' => 'RSA', 'use' => 'sig', 'alg' => 'RS256', 'kid' => config('oidc.key_id'), 'n' => $this->encode($details['rsa']['n']), 'e' => $this->encode($details['rsa']['e'])];
    }

    private function encode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function decode(string $value): string
    {
        return (string) base64_decode(strtr($value, '-_', '+/'), true);
    }
}

<?php
namespace App\Infrastructure\Security;

use RuntimeException;

final class JwkVerifier
{
    public function verify(string $jwt, array $jwks): array
    {
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) throw new RuntimeException('ID token tidak valid.');
        $header = json_decode($this->decode($parts[0]), true, 512, JSON_THROW_ON_ERROR);
        if (($header['alg'] ?? null) !== 'RS256') throw new RuntimeException('Algoritma ID token tidak diizinkan.');
        $key = null;
        foreach ($jwks['keys'] ?? [] as $candidate) if (($candidate['kid'] ?? null) === ($header['kid'] ?? null) && ($candidate['kty'] ?? null) === 'RSA') $key = $candidate;
        if (!$key || !isset($key['n'], $key['e'])) throw new RuntimeException('Signing key Portal Data tidak ditemukan.');
        $pem = $this->rsaPem($this->decode($key['n']), $this->decode($key['e']));
        if (openssl_verify($parts[0].'.'.$parts[1], $this->decode($parts[2]), $pem, OPENSSL_ALGO_SHA256) !== 1) throw new RuntimeException('Signature ID token tidak valid.');
        $claims = json_decode($this->decode($parts[1]), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($claims)) throw new RuntimeException('Claim ID token tidak valid.');
        return $claims;
    }
    private function decode(string $value): string { $padding = (4 - strlen($value) % 4) % 4; return (string) base64_decode(strtr($value.str_repeat('=', $padding), '-_', '+/'), true); }
    private function rsaPem(string $modulus, string $exponent): string
    {
        $sequence = $this->sequence($this->integer($modulus).$this->integer($exponent));
        return "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($this->sequence($this->sequence($this->oid("\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01"))."\x03".$this->length(strlen($sequence)+1)."\x00".$sequence)), 64, "\n")."-----END PUBLIC KEY-----\n";
    }
    private function integer(string $value): string { if ((ord($value[0]) & 0x80) !== 0) $value = "\x00".$value; return "\x02".$this->length(strlen($value)).$value; }
    private function sequence(string $value): string { return "\x30".$this->length(strlen($value)).$value; }
    private function oid(string $value): string { return "\x06".$this->length(strlen($value)).$value."\x05\x00"; }
    private function length(int $length): string { if ($length < 128) return chr($length); $value = ltrim(pack('N', $length), "\x00"); return chr(0x80 | strlen($value)).$value; }
}

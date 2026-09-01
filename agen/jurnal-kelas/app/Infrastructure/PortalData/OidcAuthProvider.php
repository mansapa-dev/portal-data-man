<?php
namespace App\Infrastructure\PortalData;

use App\Application\Authentication\AuthProvider;
use App\Infrastructure\Security\JwkVerifier;
use App\Support\Config;
use RuntimeException;

final class OidcAuthProvider implements AuthProvider
{
    public function __construct(private readonly Config $config, private readonly HttpClient $http, private readonly JwkVerifier $verifier) {}
    public function authorizationUrl(): string
    {
        $discovery = $this->discovery();
        $state = $this->random(); $nonce = $this->random(); $verifier = $this->random(64);
        $_SESSION['oidc_transaction'] = ['state' => $state, 'nonce' => $nonce, 'verifier' => $verifier, 'created_at' => time()];
        return $discovery['authorization_endpoint'].'?'.http_build_query(['client_id' => $this->clientId(), 'redirect_uri' => $this->redirectUri(), 'response_type' => 'code', 'scope' => 'openid profile email portal_role portal_data.read', 'state' => $state, 'nonce' => $nonce, 'code_challenge' => $this->encode(hash('sha256', $verifier, true)), 'code_challenge_method' => 'S256']);
    }
    public function authenticateCallback(string $code, string $state): array
    {
        $transaction = $_SESSION['oidc_transaction'] ?? null;
        unset($_SESSION['oidc_transaction']);
        if (!is_array($transaction) || time() - ($transaction['created_at'] ?? 0) > 600 || !hash_equals((string) ($transaction['state'] ?? ''), $state)) throw new RuntimeException('State autentikasi tidak valid atau kedaluwarsa.');
        $discovery = $this->discovery();
        $tokens = $this->http->request('POST', $discovery['token_endpoint'], ['Content-Type: application/x-www-form-urlencoded'], ['grant_type' => 'authorization_code', 'client_id' => $this->clientId(), 'code' => $code, 'redirect_uri' => $this->redirectUri(), 'code_verifier' => $transaction['verifier']], $this->timeout());
        if (!isset($tokens['access_token'], $tokens['id_token'])) throw new RuntimeException('Portal Data tidak mengirim token yang diperlukan.');
        $jwks = $this->http->request('GET', $discovery['jwks_uri'], [], null, $this->timeout());
        $claims = $this->verifier->verify($tokens['id_token'], $jwks);
        $audience = $claims['aud'] ?? null;
        if (($claims['iss'] ?? null) !== $discovery['issuer'] || $audience !== $this->clientId() || ($claims['exp'] ?? 0) <= time() || !hash_equals((string) $transaction['nonce'], (string) ($claims['nonce'] ?? ''))) throw new RuntimeException('Claim ID token gagal divalidasi.');
        $userinfo = $this->http->request('GET', $discovery['userinfo_endpoint'], ['Authorization: Bearer '.$tokens['access_token']], null, $this->timeout());
        if (($userinfo['sub'] ?? null) !== ($claims['sub'] ?? null) || !in_array(($userinfo['portal_role'] ?? null), ['TEACHER', 'ADMIN', 'AUDITOR'], true)) throw new RuntimeException('Role akun pada Jurnal Kelas tidak valid.');
        return ['user' => $userinfo, 'access_token' => $tokens['access_token'], 'expires_at' => time() + (int) ($tokens['expires_in'] ?? 900)];
    }
    public function logoutUrl(string $state): string
    {
        $discovery = $this->discovery();
        return $discovery['end_session_endpoint'].'?'.http_build_query(['post_logout_redirect_uri' => $this->config->get('portal-data.post_logout_redirect_uri'), 'state' => $state]);
    }
    private function discovery(): array { return $this->http->request('GET', rtrim((string) $this->config->get('portal-data.issuer'), '/').'/.well-known/openid-configuration', [], null, $this->timeout()); }
    private function clientId(): string { return (string) $this->config->get('portal-data.client_id'); }
    private function redirectUri(): string { return (string) $this->config->get('portal-data.redirect_uri'); }
    private function timeout(): int { return (int) $this->config->get('portal-data.timeout', 8); }
    private function random(int $bytes = 32): string { return $this->encode(random_bytes($bytes)); }
    private function encode(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }
}

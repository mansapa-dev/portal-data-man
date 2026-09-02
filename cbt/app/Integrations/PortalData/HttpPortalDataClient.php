<?php
declare(strict_types=1);

namespace Cbt\Integrations\PortalData;

use Cbt\Core\Config;

final class HttpPortalDataClient implements PortalDataClientInterface
{
    private string $base;
    private string $clientId;
    private string $clientSecret;
    private int $timeout;
    private bool $verify;
    private ?string $accessToken = null;
    private int $accessTokenExpiresAt = 0;

    public function __construct()
    {
        $this->base = rtrim((string) Config::get('PORTAL_DATA_BASE_URL'), '/');
        $this->clientId = (string) Config::get('PORTAL_DATA_SYNC_CLIENT_ID');
        $this->clientSecret = (string) Config::get('PORTAL_DATA_SYNC_CLIENT_SECRET');
        $this->timeout = (int) Config::get('PORTAL_DATA_TIMEOUT', 15);
        $this->verify = Config::bool('PORTAL_DATA_VERIFY_SSL', true);
    }

    public function students(int $page, int $limit): array { return $this->page('/api/v1/integration/cbt/students', $page, $limit); }
    public function teachers(int $page, int $limit): array { return $this->page('/api/v1/integration/cbt/teachers', $page, $limit); }
    public function classes(int $page, int $limit): array { return $this->page('/api/v1/integration/cbt/classes', $page, $limit); }
    public function academicYears(): array { return $this->reference('/api/v1/integration/cbt/academic-years'); }
    public function semesters(?string $academicYearId = null): array { return $this->reference('/api/v1/integration/cbt/semesters', $academicYearId ? ['academic_year_id' => $academicYearId] : []); }

    private function reference(string $path, array $query = []): array
    {
        $json = $this->get($path, $query);
        $data = $json['data'] ?? [];
        if (! is_array($data)) throw new PortalDataException('Format referensi Portal Data tidak sesuai kontrak.');
        return ['items' => array_values($data), 'has_more' => false];
    }

    private function page(string $path, int $page, int $limit): array
    {
        $json = $this->get($path, ['page' => $page, 'per_page' => $limit]);
        $container = $json['data'] ?? [];
        $data = $container['data'] ?? $container;
        $meta = $json['meta'] ?? ($container['meta'] ?? $container);
        if (! is_array($data)) throw new PortalDataException('Format halaman Portal Data tidak sesuai kontrak.');
        return ['items' => array_values($data), 'has_more' => (bool) ($meta['has_more'] ?? ($meta['current_page'] ?? $page) < ($meta['last_page'] ?? $page))];
    }

    private function get(string $path, array $query): array
    {
        $url = $this->base.$path.($query ? '?'.http_build_query($query) : '');
        [$status, $body, $error] = $this->request($url, ['Accept: application/json', 'Authorization: Bearer '.$this->token()]);
        if ($status === 401) {
            $this->accessToken = null;
            [$status, $body, $error] = $this->request($url, ['Accept: application/json', 'Authorization: Bearer '.$this->token()]);
        }
        if ($body === false || $status < 200 || $status >= 300) throw new PortalDataException($this->failure('Portal Data', $status, $body, $error));
        return $this->decode($body);
    }

    private function token(): string
    {
        if ($this->accessToken !== null && time() < $this->accessTokenExpiresAt - 15) return $this->accessToken;
        if ($this->base === '' || $this->clientId === '' || $this->clientSecret === '') throw new PortalDataException('Konfigurasi client sinkronisasi Portal Data belum lengkap.');
        [$status, $body, $error] = $this->request($this->base.'/oidc/token', ['Accept: application/json', 'Content-Type: application/x-www-form-urlencoded'], http_build_query(['grant_type' => 'client_credentials', 'client_id' => $this->clientId, 'client_secret' => $this->clientSecret, 'scope' => 'portal_data.read']));
        if ($body === false || $status < 200 || $status >= 300) throw new PortalDataException($this->failure('Token Portal Data', $status, $body, $error));
        $json = $this->decode($body);
        $token = $json['access_token'] ?? null;
        if (! is_string($token) || $token === '') throw new PortalDataException('Respons token Portal Data tidak valid.');
        $this->accessToken = $token;
        $this->accessTokenExpiresAt = time() + max(60, (int) ($json['expires_in'] ?? 300));
        return $token;
    }

    private function request(string $url, array $headers, ?string $postBody = null): array
    {
        $curl = curl_init($url);
        $options = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $this->timeout, CURLOPT_CONNECTTIMEOUT => $this->timeout, CURLOPT_SSL_VERIFYPEER => $this->verify, CURLOPT_HTTPHEADER => $headers];
        if ($postBody !== null) { $options[CURLOPT_POST] = true; $options[CURLOPT_POSTFIELDS] = $postBody; }
        curl_setopt_array($curl, $options);
        $body = curl_exec($curl); $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE); $error = curl_error($curl); curl_close($curl);
        return [$status, $body, $error];
    }

    private function decode(string $body): array
    {
        try { $json = json_decode($body, true, 512, JSON_THROW_ON_ERROR); } catch (\JsonException) { throw new PortalDataException('Respons Portal Data bukan JSON yang valid.'); }
        if (! is_array($json)) throw new PortalDataException('Respons Portal Data tidak valid.');
        return $json;
    }

    private function failure(string $source, int $status, string|false $body, string $curlError): string
    {
        if ($curlError !== '') return $source.' tidak dapat dihubungi: '.$curlError;
        $description = '';
        if (is_string($body) && $body !== '') { $json = json_decode($body, true); $description = (string) ($json['error_description'] ?? $json['message'] ?? ''); }
        return trim($source.' menolak permintaan (HTTP '.$status.'). '.$description);
    }
}

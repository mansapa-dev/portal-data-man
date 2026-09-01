<?php
namespace App\Infrastructure\PortalData;

use App\Support\Config;
use RuntimeException;

final class PortalDataClient
{
    public function __construct(private readonly Config $config, private readonly HttpClient $http) {}
    public function userInfo(string $token, string $endpoint): array { return $this->http->request('GET', $endpoint, ['Authorization: Bearer '.$token], null, $this->timeout()); }
    public function periods(string $token): array { return $this->data($this->get('/integration/periods', $token)); }
    public function classes(string $token): array { return $this->data($this->get('/integration/classes', $token)); }
    public function classStudents(string $classPublicId, string $token, ?string $semesterPublicId = null): array
    {
        $query = $semesterPublicId ? '?semesterPublicId='.rawurlencode($semesterPublicId) : '';
        return $this->data($this->get('/integration/classes/'.rawurlencode($classPublicId).'/students'.$query, $token));
    }
    private function get(string $path, string $token): array { return $this->http->request('GET', $this->config->get('portal-data.base_url').$path, ['Authorization: Bearer '.$token], null, $this->timeout()); }
    private function data(array $response): array { if (($response['success'] ?? false) !== true || !array_key_exists('data', $response)) throw new RuntimeException('Payload Portal Data tidak sesuai kontrak.'); return $response['data']; }
    private function timeout(): int { return (int) $this->config->get('portal-data.timeout', 8); }
}

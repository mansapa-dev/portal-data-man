<?php
namespace App\Infrastructure\PortalData;

use RuntimeException;

final class HttpClient
{
    public function request(string $method, string $url, array $headers = [], ?array $form = null, int $timeout = 8): array
    {
        $handle = curl_init($url);
        curl_setopt_array($handle, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => min(4, $timeout), CURLOPT_TIMEOUT => $timeout, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => array_merge(['Accept: application/json'], $headers)]);
        if ($form !== null) curl_setopt($handle, CURLOPT_POSTFIELDS, http_build_query($form));
        $body = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $error = curl_error($handle);
        curl_close($handle);
        if ($body === false || $error !== '') throw new RuntimeException('Portal Data tidak dapat dihubungi.');
        $decoded = json_decode($body, true);
        if ($status < 200 || $status >= 300 || !is_array($decoded)) throw new RuntimeException('Respons Portal Data tidak valid (HTTP '.$status.').');
        return $decoded;
    }
}

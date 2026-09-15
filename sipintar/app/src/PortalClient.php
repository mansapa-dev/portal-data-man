<?php
declare(strict_types=1);
namespace Sipintar;
use RuntimeException;
final class PortalClient
{
    public function __construct(private array $config) {}
    public function employees(): array
    {
        // employees_url is the canonical personnel source. Keep teachers_url as
        // a temporary fallback so existing deployments do not break before
        // their external config is updated.
        $url = $this->config['employees_url'] ?? $this->config['teachers_url'] ?? '';
        if (parse_url($url, PHP_URL_SCHEME) !== 'https') throw new RuntimeException('URL HTTPS Portal Data diperlukan.');
        $token = $this->token();
        $all = []; $page = 1;
        do {
            $ch = curl_init($url.(str_contains($url,'?') ? '&' : '?').'per_page=200&page='.$page);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>30,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_HTTPHEADER=>['Accept: application/json','Authorization: Bearer '.$token]]);
            $body = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
            if ($status !== 200 || !is_string($body)) throw new RuntimeException('Portal Data gagal diakses; data lokal dipertahankan.');
            $payload = json_decode($body,true,512,JSON_THROW_ON_ERROR);
            $data = $payload['data'] ?? null;
            if (!is_array($data) || !is_array($data['data'] ?? null) || !isset($data['last_page']) || (int)($data['current_page'] ?? 0) !== $page) throw new RuntimeException('Format respons Portal Data tidak sesuai.');
            $last = (int)$data['last_page'];
            if ($last < $page || $last > 10000) throw new RuntimeException('Jumlah halaman Portal Data tidak valid.');
            foreach ($data['data'] as $row) {
                if (empty($row['id']) || empty($row['name']) || isset($all[$row['id']])) throw new RuntimeException('Identitas pegawai tidak valid atau duplikat.');
                $all[$row['id']] = ['id'=>$row['id'],'name'=>$row['name'],'nip'=>$row['nip'] ?? null];
            }
            $page++;
        } while ($page <= $last);
        return array_values($all);
    }
    private function token(): string
    {
        $url = $this->config['token_url'] ?? '';
        if (parse_url($url, PHP_URL_SCHEME) !== 'https' || empty($this->config['client_id']) || empty($this->config['client_secret'])) throw new RuntimeException('Konfigurasi service client Portal Data diperlukan.');
        $ch=curl_init($url);
        curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>30,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_HTTPHEADER=>['Accept: application/json','Content-Type: application/x-www-form-urlencoded'],CURLOPT_POSTFIELDS=>http_build_query(['grant_type'=>'client_credentials','client_id'=>$this->config['client_id'],'client_secret'=>$this->config['client_secret'],'scope'=>'portal_data.read'])]);
        $body=curl_exec($ch); $status=curl_getinfo($ch,CURLINFO_RESPONSE_CODE); curl_close($ch);
        if($status!==200 || !is_string($body)) throw new RuntimeException('Otentikasi service client Portal Data gagal.');
        $data=json_decode($body,true,512,JSON_THROW_ON_ERROR);
        if(empty($data['access_token'])) throw new RuntimeException('Token Portal Data tidak tersedia.');
        return $data['access_token'];
    }
    public static function sync(Identity $identity, array $rows): int
    {
        if (!$rows) throw new RuntimeException('Portal mengembalikan data kosong; sinkronisasi dibatalkan agar akun tidak dinonaktifkan massal.');
        $identity->db->beginTransaction();
        try {
            $identity->query('UPDATE employees SET active=0');
            foreach ($rows as $row) {
                $exists = $identity->query('SELECT public_id FROM employees WHERE public_id=?',[$row['id']])->fetchColumn();
                if ($exists) $identity->query('UPDATE employees SET name=?,nip=?,active=1 WHERE public_id=?',[$row['name'],$row['nip'],$row['id']]);
                else $identity->query('INSERT INTO employees (public_id,name,nip,active) VALUES (?,?,?,1)',[$row['id'],$row['name'],$row['nip']]);
            }
            $identity->db->commit(); return count($rows);
        } catch (\Throwable $e) { $identity->db->rollBack(); throw $e; }
    }
}

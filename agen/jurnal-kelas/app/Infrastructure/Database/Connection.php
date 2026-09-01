<?php
namespace App\Infrastructure\Database;

use App\Support\Config;
use PDO;

final class Connection
{
    private ?PDO $pdo = null;
    public function __construct(private readonly Config $config) {}
    public function pdo(): PDO
    {
        if ($this->pdo) return $this->pdo;
        $db = $this->config->get('database');
        $dsn = "mysql:host={$db['host']};port={$db['port']};dbname={$db['database']};charset={$db['charset']}";
        return $this->pdo = new PDO($dsn, $db['username'], $db['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
    }
}

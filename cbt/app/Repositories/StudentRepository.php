<?php
declare(strict_types=1);
namespace Cbt\Repositories;
use PDO;
final class StudentRepository
{
    public function __construct(private PDO $db) {}
    public function findActiveByNisn(string $nisn): ?array
    {
        $statement = $this->db->prepare("SELECT * FROM students WHERE nisn = :nisn AND is_active = 1 LIMIT 1");
        $statement->execute(['nisn' => $nisn]);
        return $statement->fetch() ?: null;
    }
}

<?php
declare(strict_types=1);
namespace Sipintar;
final class Database
{
    public function __construct(private \mysqli $db) {}
    public function query(string $sql, array $params=[]): \mysqli_stmt {
        $s=$this->db->prepare($sql);
        if ($params) { $types=''; foreach($params as $p) $types.=is_int($p)?'i':'s'; $s->bind_param($types,...$params); }
        $s->execute(); return $s;
    }
}

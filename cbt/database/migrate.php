<?php
declare(strict_types=1);
require dirname(__DIR__).'/bootstrap.php';
use Cbt\Core\Database;
if(PHP_SAPI!=='cli'){http_response_code(403);exit("CLI only\n");}
$schema=file_get_contents(__DIR__.'/schema.sql');if($schema===false)throw new RuntimeException('schema.sql tidak ditemukan.');
$db=(new Database())->pdo();$db->exec($schema);fwrite(STDOUT,"Schema CBT berhasil diterapkan.\n");

<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }

require dirname(__DIR__).'/bootstrap.php';

use Cbt\Core\Database;

session_write_close();
$path = dirname(__DIR__).'/database/migrations/20260915_separate_exam_proctors.sql';
$sql = file_get_contents($path);
if ($sql === false) throw new RuntimeException('Migration piket ujian tidak ditemukan.');
(new Database())->pdo()->exec($sql);
fwrite(STDOUT, "Pemisahan guru mapel dan petugas piket berhasil diterapkan.\n");

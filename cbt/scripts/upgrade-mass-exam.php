<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit;}
require dirname(__DIR__).'/bootstrap.php';
use Cbt\Core\Database;
session_write_close();
$pdo=(new Database())->pdo();
// Narrow upgrade for existing installations; fresh installations also contain these tables in schema.sql.
foreach(['20260907_answer_write_versions.sql','20260907_attempt_connections.sql','20260907_attempt_questions.sql'] as $file){
 $sql=file_get_contents(dirname(__DIR__).'/database/migrations/'.$file);
 if($sql===false)throw new RuntimeException('Migration tidak ditemukan: '.$file);
 $pdo->exec($sql);fwrite(STDOUT,'Applied '.$file.PHP_EOL);
}
fwrite(STDOUT,"Upgrade selesai. Snapshot attempt lama menggunakan isi soal yang tersedia saat migrasi.\n");

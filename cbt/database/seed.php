<?php
declare(strict_types=1);

use Cbt\Core\Database;
use Cbt\Support\Id;

require dirname(__DIR__).'/bootstrap.php';
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }

$pdo=(new Database())->pdo();
$subjects=[['BIO','Biologi'],['KIM','Kimia'],['FIS','Fisika'],['MTKW','Matematika Wajib'],['MTKL','Matematika Tingkat Lanjut'],['GEO','Geografi'],['SOS','Sosiologi'],['EKO','Ekonomi'],['SEJ','Sejarah'],['SEJL','Sejarah Tingkat Lanjut'],['BIN','Bahasa Indonesia'],['BIG','Bahasa Inggris'],['BIGL','Bahasa Inggris Tingkat Lanjut'],['BAR','Bahasa Arab'],['TAHFIDZ','Tahfidz'],['AA','Akidah Akhlak'],['PPKN','Pendidikan Pancasila'],['QH','Al-Qur\'an Hadist'],['FIK','Fikih'],['SKI','Sejarah Kebudayaan Islam'],['SBK','Seni Budaya'],['INF','Informatika'],['PJOK','PJOK'],['BK','BK']];
$pdo->beginTransaction();
try {
    $statement=$pdo->prepare("INSERT INTO subjects(public_id,code,name,status) VALUES(:public_id,:code,:name,'ACTIVE') ON DUPLICATE KEY UPDATE name=VALUES(name),status='ACTIVE'");
    foreach($subjects as[$code,$name])$statement->execute(['public_id'=>Id::ulid(),'code'=>$code,'name'=>$name]);
    $pdo->commit();fwrite(STDOUT,count($subjects)." mata pelajaran berhasil disiapkan.\n");
} catch(Throwable$error){$pdo->rollBack();throw$error;}

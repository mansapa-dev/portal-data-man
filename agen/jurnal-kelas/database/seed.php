<?php
declare(strict_types=1);
use App\Infrastructure\Database\Connection;
use App\Support\Ulid;
$container = require dirname(__DIR__).'/bootstrap/app.php';
$pdo = $container->get(Connection::class)->pdo();
$pdo->beginTransaction();
try {
    $statement = $pdo->prepare("INSERT INTO application_settings(setting_key,setting_value,setting_type) VALUES(:key,:value,:type) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),setting_type=VALUES(setting_type)");
    foreach ([['journal_edit_hours','24','INTEGER'],['school_name','MAN 1 Palembang','STRING']] as [$key,$value,$type]) $statement->execute(compact('key','value','type'));
    $subject = $pdo->prepare("INSERT INTO subjects(public_id,code,name,status) VALUES(:public_id,:code,:name,'ACTIVE') ON DUPLICATE KEY UPDATE name=VALUES(name),status='ACTIVE',deleted_at=NULL");
    foreach ([['BIO','Biologi'],['KIM','Kimia'],['FIS','Fisika'],['MTKW','Matematika Wajib'],['MTKL','Matematika Tingkat Lanjut'],['GEO','Geografi'],['SOS','Sosiologi'],['EKO','Ekonomi'],['SEJ','Sejarah'],['SEJL','Sejarah Tingkat Lanjut'],['BIN','Bahasa Indonesia'],['BIG','Bahasa Inggris'],['BIGL','Bahasa Inggris Tingkat Lanjut'],['BAR','Bahasa Arab'],['TAHFIDZ','Tahfidz'],['AA','Akidah Akhlak'],['PPKN','Pendidikan Pancasila'],['QH','Al-Qur\'an Hadist'],['FIK','Fikih'],['SKI','Sejarah Kebudayaan Islam'],['SBK','Seni Budaya'],['INF','Informatika'],['PJOK','PJOK'],['BK','BK']] as [$code,$name]) $subject->execute(['public_id'=>Ulid::generate(),'code'=>$code,'name'=>$name]);
    $pdo->commit();
    fwrite(STDOUT, "Konfigurasi development berhasil dibuat tanpa akun/password lokal.\n");
} catch (Throwable $error) { $pdo->rollBack(); throw $error; }
